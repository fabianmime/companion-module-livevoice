import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { RawData } from 'ws'
import { parse as parseHtml } from 'node-html-parser'
import type { ImportState, LiveVoiceChannel, LiveVoiceDiscovery, LiveVoiceEventState } from './types.js'

const ORIGIN = 'https://livevoice.io'
const DISCOVERY_TIMEOUT_MS = 10_000
const AUTH_TIMEOUT_MS = 10_000
const CABLE_HANDSHAKE_TIMEOUT_MS = 15_000
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
const V2_CHANNEL_IDENTIFIER = JSON.stringify({ channel: 'V2Channel' })

export type LiveVoiceErrorCode =
	| 'discovery-http-error'
	| 'discovery-parse-error'
	| 'auth-invalid-api-key'
	| 'auth-invalid-device-id'
	| 'auth-http-error'
	| 'cable-error'
	| 'not-ready'

export class LiveVoiceError extends Error {
	constructor(
		public readonly code: LiveVoiceErrorCode,
		message: string,
	) {
		super(message)
		this.name = 'LiveVoiceError'
	}
}

function toLiveVoiceError(error: unknown, fallbackCode: LiveVoiceErrorCode = 'cable-error'): LiveVoiceError {
	if (error instanceof LiveVoiceError) return error
	if (error instanceof Error && error.name === 'AbortError') {
		return new LiveVoiceError(fallbackCode, 'Zeitüberschreitung bei der Verbindung zu LiveVoice')
	}
	return new LiveVoiceError(fallbackCode, error instanceof Error ? error.message : String(error))
}

/**
 * Dekodiert die in `data-streaming-api-headers` üblichen HTML-Entities, bevor der Wert als JSON geparst wird
 * (siehe INFO.md Abschnitt 4). `&amp;` bewusst zuletzt, damit z.B. `&amp;quot;` nicht doppelt entschärft wird.
 */
export function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
}

const MAX_DISCOVERY_REDIRECTS = 5

/**
 * LiveVoice setzt beim ersten Aufruf des Operator-Links ein Session-Cookie und leitet danach auf die
 * kanonische Kurz-URL weiter (siehe INFO.md Abschnitt 3). Node's `fetch` hat keinen Cookie-Jar - bei
 * `redirect: 'follow'` geht das Set-Cookie der ersten Antwort beim automatischen Redirect verloren, und
 * der Ziel-Request landet ohne Session-Cookie auf einem echten HTTP 404 (im Browser unsichtbar, da der
 * dortige Cookie-Jar das automatisch mitschickt). Redirects deshalb hier manuell verfolgen und alle
 * bisher gesetzten Cookies bei jedem weiteren Hop mitschicken.
 */
export async function fetchFollowingRedirectsWithCookies(url: string, signal: AbortSignal): Promise<Response> {
	const cookieJar = new Map<string, string>()
	let currentUrl = url

	for (let redirect = 0; redirect <= MAX_DISCOVERY_REDIRECTS; redirect++) {
		const cookieHeader = Array.from(cookieJar.entries())
			.map(([name, value]) => `${name}=${value}`)
			.join('; ')

		const response = await fetch(currentUrl, {
			method: 'GET',
			redirect: 'manual',
			signal,
			headers: { Accept: 'text/html', ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
		})

		for (const setCookie of response.headers.getSetCookie()) {
			const pair = setCookie.split(';', 1)[0]
			const separatorIndex = pair.indexOf('=')
			if (separatorIndex === -1) continue
			cookieJar.set(pair.slice(0, separatorIndex).trim(), pair.slice(separatorIndex + 1).trim())
		}

		if (response.status < 300 || response.status >= 400) return response

		const location = response.headers.get('location')
		if (!location) return response
		currentUrl = new URL(location, currentUrl).toString()
	}

	throw new LiveVoiceError('discovery-http-error', 'Zu viele Redirects beim Laden der Operator-Seite')
}

/**
 * Sucht im Operator-HTML das Element mit `data-streaming-api-url`/`data-streaming-api-headers` (siehe
 * INFO.md Abschnitt 2+4). Übernimmt bewusst alle Header-Keys aus dem JSON statt einer festen Allowlist,
 * damit neue von LiveVoice ergänzte Header nicht verloren gehen.
 */
export function extractDiscovery(html: string): LiveVoiceDiscovery | undefined {
	const root = parseHtml(html)
	const element = root.querySelector('[data-streaming-api-url]')
	if (!element) return undefined

	const rawAuthUrl = element.getAttribute('data-streaming-api-url')
	const rawHeaders = element.getAttribute('data-streaming-api-headers')
	if (!rawAuthUrl || !rawHeaders) return undefined

	let parsedHeaders: unknown
	try {
		parsedHeaders = JSON.parse(decodeHtmlEntities(rawHeaders))
	} catch {
		return undefined
	}
	if (typeof parsedHeaders !== 'object' || parsedHeaders === null) return undefined

	const headers: Record<string, string> = {}
	for (const [key, value] of Object.entries(parsedHeaders as Record<string, unknown>)) {
		if (typeof value === 'string') headers[key] = value
	}

	return {
		authUrl: decodeHtmlEntities(rawAuthUrl),
		headers,
		operatorToken: headers['client-operator-token'],
	}
}

export function buildSubscribeFrame(): string {
	return JSON.stringify({ command: 'subscribe', identifier: V2_CHANNEL_IDENTIFIER })
}

export function buildPongFrame(): string {
	return JSON.stringify({ command: 'pong' })
}

/** Baut die start_importing/stop_importing ActionCable-Nachricht (siehe INFO.md Abschnitt 8/9/41/42). */
export function buildImportActionFrame(channelId: number, action: 'start_importing' | 'stop_importing'): string {
	return JSON.stringify({
		command: 'message',
		identifier: V2_CHANNEL_IDENTIFIER,
		data: JSON.stringify({ channel_id: channelId, action }),
	})
}

/** `RawData` covers Buffer/ArrayBuffer/Buffer[] - only `Buffer.toString()` is meaningful, so normalise first. */
function rawDataToString(data: RawData): string {
	if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
	return data.toString('utf8')
}

interface CableEnvelope {
	type?: string
	identifier?: string
	message?: unknown
}

function parseCableEnvelope(raw: string): CableEnvelope | undefined {
	try {
		const parsed = JSON.parse(raw) as unknown
		if (typeof parsed !== 'object' || parsed === null) return undefined
		return parsed
	} catch {
		return undefined
	}
}

/** Primär `state_class`, Fallback auf das Settings-Markup (siehe INFO.md Abschnitt 10/24). */
export function mapInitialImportState(stateType: string | undefined): ImportState {
	if (stateType === 'offline') return 'offline'
	if (stateType === 'active') return 'active'
	if (stateType === 'inactive') return 'inactive'
	return 'unknown'
}

export function mapChannelUpdatedState(message: {
	state_class?: string
	settings_markup?: Record<string, unknown>
}): ImportState {
	if (message.state_class === 'active') return 'active'
	if (message.state_class === 'inactive') return 'inactive'
	if (message.state_class === 'offline') return 'offline'

	const markup = Object.values(message.settings_markup ?? {})
		.filter((value): value is string => typeof value === 'string')
		.join('\n')
	if (markup.includes('streaming-channel#stopImporting')) return 'active'
	if (markup.includes('streaming-channel#startImporting')) return 'inactive'

	return 'unknown'
}

function narrow<T>(items: T[], predicate: (item: T) => boolean): T[] {
	const filtered = items.filter(predicate)
	return filtered.length > 0 ? filtered : items
}

/** Automatische Erkennung des Quell-Channels (siehe INFO.md Abschnitt 7+25) - nie anhand einer festen ID. */
export function selectDefaultImportChannel(channels: LiveVoiceChannel[]): LiveVoiceChannel | undefined {
	let pool = channels.filter((channel) => channel.hasAudio === true)
	if (pool.length === 0) return undefined

	pool = narrow(pool, (channel) => channel.hasSubtitles === false)
	pool = narrow(pool, (channel) => channel.isChild !== true)

	if (pool.length === 1) return pool[0]

	return pool.find((channel) => channel.name.trim().toLowerCase() === 'original audio')
}

interface AuthenticateResponse {
	cable_url: string
	access_token: string
}

type LiveVoiceClientEvents = {
	connected: []
	disconnected: [reason: string]
	event: [state: LiveVoiceEventState]
	channelUpdated: [channel: LiveVoiceChannel]
	statistics: [channelId: number, listeners: number]
	error: [error: LiveVoiceError]
}

/**
 * Kapselt die komplette LiveVoice-Protokolllogik (Discovery, Auth, ActionCable, Reconnect, State-Parsing) -
 * bewusst ohne jeden Companion-Import, siehe INFO.md Abschnitt 29/30. Companion-Instance hört auf die
 * emittierten Events und aktualisiert Status/Variablen/Feedbacks selbst.
 */
export class LiveVoiceClient extends EventEmitter {
	private operatorUrl?: string
	private ws?: WebSocket
	private subscribed = false
	private destroyed = true
	private reconnectAttempt = 0
	private reconnectTimer?: ReturnType<typeof setTimeout>
	private connectGeneration = 0
	private eventState: LiveVoiceEventState = { channels: new Map() }
	private readonly debugLog: (message: string) => void

	constructor(options: { debug?: (message: string) => void } = {}) {
		super()
		this.debugLog = options.debug ?? ((): void => undefined)
	}

	override on<K extends keyof LiveVoiceClientEvents>(
		event: K,
		listener: (...args: LiveVoiceClientEvents[K]) => void,
	): this {
		return super.on(event, listener as (...args: unknown[]) => void)
	}

	override emit<K extends keyof LiveVoiceClientEvents>(event: K, ...args: LiveVoiceClientEvents[K]): boolean {
		return super.emit(event, ...args)
	}

	getEvent(): LiveVoiceEventState {
		return this.eventState
	}

	getChannel(channelId: number): LiveVoiceChannel | undefined {
		return this.eventState.channels.get(channelId)
	}

	isConnected(): boolean {
		return this.subscribed
	}

	/** Startet den Verbindungsaufbau. Wirft nie - Fehler werden über das `error`-Event gemeldet. */
	async connect(operatorUrl: string): Promise<void> {
		this.disconnect()
		this.operatorUrl = operatorUrl
		this.destroyed = false
		this.reconnectAttempt = 0
		this.eventState = { channels: new Map() }
		const generation = ++this.connectGeneration
		await this.attemptConnect(generation, true)
	}

	disconnect(): void {
		this.destroyed = true
		this.connectGeneration++
		this.clearReconnectTimer()
		this.subscribed = false
		if (this.ws) {
			this.ws.removeAllListeners()
			try {
				this.ws.close()
			} catch {
				// Verbindung war ohnehin schon tot - nichts zu tun.
			}
			this.ws = undefined
		}
	}

	/** Sendet start_importing, sofern aktuell verbunden/subscribed. Meldet sich sonst über das error-Event. */
	async startImport(channelId: number): Promise<void> {
		this.sendImportAction(channelId, 'start_importing')
	}

	async stopImport(channelId: number): Promise<void> {
		this.sendImportAction(channelId, 'stop_importing')
	}

	private sendImportAction(channelId: number, action: 'start_importing' | 'stop_importing'): void {
		if (!this.ws || !this.subscribed || this.ws.readyState !== WebSocket.OPEN) {
			this.debugLog(`Aktion ${action} verworfen: keine aktive LiveVoice-Verbindung`)
			this.emit(
				'error',
				new LiveVoiceError('not-ready', 'Aktion konnte nicht gesendet werden: keine aktive Verbindung'),
			)
			return
		}
		try {
			this.ws.send(buildImportActionFrame(channelId, action))
		} catch (error) {
			this.emit('error', toLiveVoiceError(error))
		}
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}
	}

	private scheduleReconnect(generation: number, reason: string): void {
		if (this.destroyed || generation !== this.connectGeneration) return
		this.subscribed = false
		this.emit('disconnected', reason)

		const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
		this.reconnectAttempt++
		this.debugLog(`Reconnect in ${delay}ms (Versuch ${this.reconnectAttempt}): ${reason}`)

		this.clearReconnectTimer()
		this.reconnectTimer = setTimeout(() => {
			this.attemptConnect(generation, true).catch((error: unknown) => {
				this.emit('error', toLiveVoiceError(error))
				this.scheduleReconnect(generation, 'Reconnect fehlgeschlagen')
			})
		}, delay)
	}

	/**
	 * Führt Discovery -> Authenticate -> Cable-Connect durch. Bei invalid_api_key/invalid_device_id wird die
	 * Operator-Seite einmal neu geladen und erneut versucht (siehe INFO.md Abschnitt 14/22), danach nicht mehr
	 * aggressiv retried, sondern über den normalen Reconnect-Backoff.
	 */
	private async attemptConnect(generation: number, retryAuthOnce: boolean): Promise<void> {
		if (!this.operatorUrl) return
		try {
			const discovery = await this.discoverWithTimeout(this.operatorUrl)
			if (generation !== this.connectGeneration) return
			this.debugLog('Operator URL loaded successfully')
			this.debugLog('Discovered event authentication endpoint')

			const auth = await this.authenticateWithTimeout(discovery, this.operatorUrl)
			if (generation !== this.connectGeneration) return
			this.debugLog('Authentication successful')

			await this.connectCable(generation, auth.cable_url, auth.access_token)
		} catch (error) {
			if (generation !== this.connectGeneration) return
			const liveVoiceError = toLiveVoiceError(error)
			const isAuthError =
				liveVoiceError.code === 'auth-invalid-api-key' || liveVoiceError.code === 'auth-invalid-device-id'

			if (retryAuthOnce && isAuthError) {
				this.debugLog(
					`Auth fehlgeschlagen (${liveVoiceError.code}), lade Operator-Seite erneut und versuche einmal neu`,
				)
				await this.attemptConnect(generation, false)
				return
			}

			this.emit('error', liveVoiceError)
			this.scheduleReconnect(generation, liveVoiceError.message)
		}
	}

	private async discoverWithTimeout(operatorUrl: string): Promise<LiveVoiceDiscovery> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
		try {
			const response = await fetchFollowingRedirectsWithCookies(operatorUrl, controller.signal)
			if (!response.ok) {
				throw new LiveVoiceError('discovery-http-error', `Operator-Seite antwortete mit HTTP ${response.status}`)
			}
			const html = await response.text()
			const discovery = extractDiscovery(html)
			if (!discovery) {
				throw new LiveVoiceError(
					'discovery-parse-error',
					'Operator-Link konnte nicht als LiveVoice-Operator-Seite erkannt werden',
				)
			}
			return discovery
		} catch (error) {
			throw toLiveVoiceError(error, 'discovery-http-error')
		} finally {
			clearTimeout(timeout)
		}
	}

	private async authenticateWithTimeout(
		discovery: LiveVoiceDiscovery,
		operatorUrl: string,
	): Promise<AuthenticateResponse> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS)
		try {
			const response = await fetch(discovery.authUrl, {
				method: 'POST',
				redirect: 'follow',
				signal: controller.signal,
				headers: { ...discovery.headers, Origin: ORIGIN, Referer: operatorUrl, Accept: '*/*' },
			})

			const body = (await response.json().catch(() => undefined)) as
				{ error?: string; cable_url?: string; access_token?: string } | undefined

			if (body?.error === 'invalid_api_key') {
				throw new LiveVoiceError('auth-invalid-api-key', 'Authentifizierung fehlgeschlagen: invalid_api_key')
			}
			if (body?.error === 'invalid_device_id') {
				throw new LiveVoiceError('auth-invalid-device-id', 'Authentifizierung fehlgeschlagen: invalid_device_id')
			}
			if (!response.ok || !body?.cable_url || !body.access_token) {
				throw new LiveVoiceError('auth-http-error', `Authentifizierung fehlgeschlagen (HTTP ${response.status})`)
			}

			return { cable_url: body.cable_url, access_token: body.access_token }
		} catch (error) {
			throw toLiveVoiceError(error, 'auth-http-error')
		} finally {
			clearTimeout(timeout)
		}
	}

	/**
	 * Öffnet die ActionCable-WebSocket-Verbindung und löst erst auf, sobald die V2Channel-Subscription
	 * bestätigt ist (siehe INFO.md Abschnitt 5). Danach laufen Ping/Pong und Channel-Updates über die
	 * `message`-Listener weiter, bis die Verbindung getrennt wird - dann greift `scheduleReconnect`.
	 */
	private async connectCable(generation: number, cableUrl: string, accessToken: string): Promise<void> {
		return new Promise((resolve, reject) => {
			let settled = false
			const url = `${cableUrl}?access_token=${encodeURIComponent(accessToken)}`
			const ws = new WebSocket(url, { headers: { Origin: ORIGIN } })
			this.ws = ws

			const handshakeTimeout = setTimeout(() => {
				if (settled) return
				settled = true
				ws.terminate()
				reject(new LiveVoiceError('cable-error', 'Zeitüberschreitung beim Verbindungsaufbau zu LiveVoice ActionCable'))
			}, CABLE_HANDSHAKE_TIMEOUT_MS)

			ws.on('message', (data: RawData) => {
				const envelope = parseCableEnvelope(rawDataToString(data))
				if (!envelope) {
					this.debugLog('Ungültige ActionCable-Nachricht ignoriert')
					return
				}

				if (envelope.type === 'ping') {
					ws.send(buildPongFrame())
					return
				}

				if (envelope.type === 'welcome') {
					ws.send(buildSubscribeFrame())
					return
				}

				if (envelope.type === 'confirm_subscription') {
					this.debugLog('Cable connected')
					this.debugLog('V2Channel subscribed')
					this.subscribed = true
					this.reconnectAttempt = 0
					clearTimeout(handshakeTimeout)
					if (!settled) {
						settled = true
						resolve()
					}
					this.emit('connected')
					return
				}

				if (envelope.type === 'disconnect' || envelope.type === 'reject_subscription') {
					this.debugLog(`ActionCable meldet ${envelope.type}`)
					return
				}

				if (envelope.identifier === V2_CHANNEL_IDENTIFIER && envelope.message !== undefined) {
					this.handleChannelMessage(envelope.message)
					return
				}

				this.debugLog(`Unbekannter ActionCable-Message-Type ignoriert: ${envelope.type ?? 'unknown'}`)
			})

			ws.on('close', (code: number) => {
				clearTimeout(handshakeTimeout)
				if (!settled) {
					settled = true
					reject(new LiveVoiceError('cable-error', `ActionCable-Verbindung geschlossen (Code ${code})`))
					return
				}
				this.scheduleReconnect(generation, `Verbindung getrennt (Code ${code})`)
			})

			ws.on('error', (error: Error) => {
				clearTimeout(handshakeTimeout)
				if (!settled) {
					settled = true
					reject(new LiveVoiceError('cable-error', error.message))
				}
			})
		})
	}

	private handleChannelMessage(raw: unknown): void {
		if (typeof raw !== 'object' || raw === null) return
		const message = raw as Record<string, unknown>

		if (message.type === 'init_event') {
			this.applyInitEvent(message)
			return
		}
		if (message.type === 'channel_updated') {
			this.applyChannelUpdated(message)
			return
		}
		if (message.type === 'statistics') {
			const channelId = Number(message.channel_id)
			const listeners = Number(message.listeners)
			if (!Number.isFinite(channelId) || !Number.isFinite(listeners)) return
			const channel = this.eventState.channels.get(channelId)
			if (channel) channel.listeners = listeners
			this.debugLog(`Statistics: channel ${channelId} listeners=${listeners}`)
			this.emit('statistics', channelId, listeners)
			return
		}

		// z.B. chat_messages - für dieses Modul bewusst nicht implementiert (siehe INFO.md Abschnitt 12).
		this.debugLog(`Unbekannte Channel-Message ignoriert: ${String(message.type)}`)
	}

	private applyInitEvent(message: Record<string, unknown>): void {
		const channels = new Map<number, LiveVoiceChannel>()
		const rawChannels = Array.isArray(message.channels) ? message.channels : []

		for (const raw of rawChannels) {
			if (typeof raw !== 'object' || raw === null) continue
			const channel = raw as Record<string, unknown>
			const id = Number(channel.id)
			if (!Number.isFinite(id)) continue
			const state = channel.state as Record<string, unknown> | undefined
			const stateType = typeof state?.type === 'string' ? state.type : undefined
			const initialImportState = mapInitialImportState(stateType)

			if (initialImportState === 'unknown') {
				// Bisher wurde nur state.type "offline" beim Verbinden vor Start eines Imports beobachtet (siehe
				// INFO.md Abschnitt 34) - ein unbekannter Wert hier (z.B. beim Reconnect in einen bereits
				// laufenden Import) ist ein echter, bisher nicht dokumentierter Protokoll-Fall. Roh-Wert loggen,
				// damit sich die Zuordnung nachträglich ergänzen lässt, statt den Zustand zu erraten.
				this.debugLog(`Unbekannter initialer Channel-State "${String(stateType)}" (Channel ${id}) - bleibt "unknown"`)
			}

			channels.set(id, {
				id,
				name: typeof channel.name === 'string' ? channel.name : `Channel ${id}`,
				hasAudio: typeof channel.has_audio === 'boolean' ? channel.has_audio : undefined,
				hasSubtitles: typeof channel.has_subtitles === 'boolean' ? channel.has_subtitles : undefined,
				isChild: typeof channel.is_child === 'boolean' ? channel.is_child : undefined,
				stateType,
				importState: initialImportState,
			})
		}

		this.eventState = {
			eventId: typeof message.event_id === 'number' ? message.event_id : undefined,
			name: typeof message.name === 'string' ? message.name : undefined,
			joinCode: typeof message.listener_join_code === 'string' ? message.listener_join_code : undefined,
			listenerShareUrl: typeof message.listener_share_url === 'string' ? message.listener_share_url : undefined,
			channels,
		}

		this.emit('event', this.eventState)
	}

	private applyChannelUpdated(message: Record<string, unknown>): void {
		const id = Number(message.channel_id)
		if (!Number.isFinite(id)) return

		const existing: LiveVoiceChannel = this.eventState.channels.get(id) ?? {
			id,
			name: typeof message.name === 'string' ? message.name : `Channel ${id}`,
			importState: 'unknown',
		}

		const stateClass = typeof message.state_class === 'string' ? message.state_class : undefined
		const nextState = mapChannelUpdatedState({
			state_class: stateClass,
			settings_markup: message.settings_markup as Record<string, unknown> | undefined,
		})

		if (nextState !== existing.importState) {
			this.debugLog(`Import state changed: ${existing.importState} -> ${nextState} (Channel ${id})`)
		}
		if (nextState === 'unknown') {
			this.debugLog(
				`Unbekannter state_class "${String(stateClass)}" bei channel_updated (Channel ${id}) - bleibt "unknown"`,
			)
		}

		const updated: LiveVoiceChannel = {
			...existing,
			name: typeof message.name === 'string' ? message.name : existing.name,
			stateClass,
			importState: nextState,
		}

		this.eventState.channels.set(id, updated)
		this.emit('channelUpdated', updated)
	}
}
