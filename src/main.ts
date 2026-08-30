import {
	InstanceBase,
	InstanceStatus,
	type DropdownChoice,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import { GetConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { LiveVoiceClient, LiveVoiceError, selectDefaultImportChannel } from './livevoice-client.js'
import type { LiveVoiceChannel, LiveVoiceEventState } from './types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	secrets!: ModuleSecrets // Setup in init()

	readonly client: LiveVoiceClient

	/** Channels des zuletzt bekannten Events - lässt das Config-UI den Channel als Dropdown anbieten. */
	knownChannels: LiveVoiceChannel[] = []

	constructor(internal: unknown) {
		super(internal)
		this.client = new LiveVoiceClient({
			debug: (message) => {
				if (this.config?.debugLogging) this.log('debug', message)
			},
		})
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.config = config
		this.secrets = secrets

		this.setVariableValues({
			connection_status: 'connecting',
			event_name: '',
			event_id: '',
			join_code: '',
			import_channel_name: '',
			import_channel_id: '',
			import_state: 'unknown',
			listener_count: 0,
		})

		this.registerClientEvents()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()

		await this.connect()
	}

	async destroy(): Promise<void> {
		this.client.disconnect()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		const operatorUrlChanged = this.secrets?.operatorUrl !== secrets.operatorUrl
		this.config = config
		this.secrets = secrets

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()

		if (operatorUrlChanged) {
			await this.connect()
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields(this.knownChannels)
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	/** Dropdown-Choices für Action-/Feedback-Channel-Optionen: "Auto" plus alle Channels des aktuellen Events. */
	getChannelActionChoices(): DropdownChoice[] {
		const channels = Array.from(this.client.getEvent().channels.values()).sort((a, b) => a.name.localeCompare(b.name))
		return [{ id: 'auto', label: 'Auto / Quellkanal' }, ...channels.map((channel) => this.channelChoice(channel))]
	}

	private channelChoice(channel: LiveVoiceChannel): DropdownChoice {
		return { id: String(channel.id), label: `${channel.name} (${channel.id})` }
	}

	/** Löst "auto"/leer über {@link selectDefaultImportChannel} auf, sonst eine konkret gewählte Channel-ID. */
	resolveChannelId(value: string): number | undefined {
		const channels = Array.from(this.client.getEvent().channels.values())
		if (!value || value === 'auto') {
			return selectDefaultImportChannel(channels)?.id
		}
		const numeric = Number(value)
		if (!Number.isFinite(numeric)) return undefined
		return channels.some((channel) => channel.id === numeric) ? numeric : undefined
	}

	async startImport(channelId: number): Promise<void> {
		await this.client.startImport(channelId)
	}

	async stopImport(channelId: number): Promise<void> {
		await this.client.stopImport(channelId)
	}

	/** Schaltet nur um, wenn der tatsächliche Serverstatus eindeutig ist - siehe INFO.md Abschnitt 16. */
	async toggleImport(channelId: number): Promise<void> {
		const channel = this.client.getChannel(channelId)
		if (!channel || channel.importState === 'unknown') {
			this.log(
				'warn',
				`Import umschalten: Status von Channel ${channelId} ist unbekannt, Aktion wird nicht ausgeführt.`,
			)
			return
		}
		if (channel.importState === 'active') {
			await this.client.stopImport(channelId)
		} else {
			await this.client.startImport(channelId)
		}
	}

	private async connect(): Promise<void> {
		const operatorUrl = this.secrets?.operatorUrl?.trim()
		if (!operatorUrl) {
			this.updateStatus(InstanceStatus.BadConfig, 'Operator-Link ist erforderlich.')
			return
		}
		this.updateStatus(InstanceStatus.Connecting, 'Verbinde mit LiveVoice...')
		await this.client.connect(operatorUrl)
	}

	private registerClientEvents(): void {
		this.client.on('connected', () => {
			const event = this.client.getEvent()
			this.updateStatus(InstanceStatus.Ok, `Connected: ${event.name ?? 'Event'}`)
			this.setVariableValues({ connection_status: 'ok' })
			this.checkFeedbacks('connected')
		})

		this.client.on('disconnected', (reason) => {
			this.updateStatus(InstanceStatus.Disconnected, `Getrennt - verbinde erneut (${reason})`)
			this.setVariableValues({ connection_status: 'disconnected' })
			this.checkFeedbacks('connected')
		})

		this.client.on('event', (eventState) => {
			this.log('info', `Event: ${eventState.name ?? 'unbekannt'} (${eventState.eventId ?? '-'})`)
			for (const channel of eventState.channels.values()) {
				this.log('info', `Channel: ${channel.name} (${channel.id})`)
			}

			this.knownChannels = Array.from(eventState.channels.values())
			this.updateActions()
			this.updateFeedbacks()
			this.updatePresets()
			this.updateVariableDefinitions()
			this.updateEventVariables(eventState)
			this.checkFeedbacks('importActive', 'importInactive', 'listenerCountCompare', 'connected')
		})

		this.client.on('channelUpdated', () => {
			this.knownChannels = Array.from(this.client.getEvent().channels.values())
			this.updateSelectedChannelVariables()
			this.checkFeedbacks('importActive', 'importInactive')
		})

		this.client.on('statistics', () => {
			this.updateSelectedChannelVariables()
			this.checkFeedbacks('listenerCountCompare')
		})

		this.client.on('error', (error: LiveVoiceError) => {
			this.log('warn', `LiveVoice-Fehler: ${error.message}`)
			if (error.code === 'auth-invalid-api-key' || error.code === 'auth-invalid-device-id') {
				this.updateStatus(InstanceStatus.AuthenticationFailure, error.message)
			} else if (error.code === 'discovery-parse-error' || error.code === 'discovery-http-error') {
				this.updateStatus(
					InstanceStatus.ConnectionFailure,
					'Operator-Link konnte nicht als LiveVoice-Seite erkannt werden',
				)
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, error.message)
			}
		})
	}

	private updateEventVariables(eventState: LiveVoiceEventState): void {
		this.setVariableValues({
			event_name: eventState.name ?? '',
			event_id: eventState.eventId !== undefined ? String(eventState.eventId) : '',
			join_code: eventState.joinCode ?? '',
		})
		this.updateSelectedChannelVariables()
	}

	private updateSelectedChannelVariables(): void {
		const channelId = this.resolveChannelId(this.config?.preferredChannelId ?? 'auto')
		const channel = channelId !== undefined ? this.client.getChannel(channelId) : undefined

		this.setVariableValues({
			import_channel_name: channel?.name ?? '',
			import_channel_id: channel !== undefined ? String(channel.id) : '',
			import_state: channel?.importState ?? 'unknown',
			listener_count: channel?.listeners ?? 0,
		})
	}
}
