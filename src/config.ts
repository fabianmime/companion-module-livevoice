import type { SomeCompanionConfigField } from '@companion-module/base'
import type { LiveVoiceChannel } from './types.js'

export type ModuleConfig = {
	preferredChannelId: string
	debugLogging: boolean
}

export type ModuleSecrets = {
	operatorUrl: string
}

/**
 * Vor der ersten erfolgreichen Verbindung kennt das Modul die echten Channels noch nicht - dann bleibt es
 * beim freien Textfeld ("auto" als Default). Sobald ein `init_event` verarbeitet wurde (siehe main.ts),
 * wird daraus ein Dropdown mit den tatsächlichen Channels des aktuellen Events.
 */
function preferredChannelField(knownChannels: LiveVoiceChannel[]): SomeCompanionConfigField {
	if (knownChannels.length === 0) {
		return {
			type: 'textinput',
			id: 'preferredChannelId',
			label: 'Bevorzugter Import-Channel',
			tooltip:
				'"auto" wählt automatisch den erkannten Quell-Channel (Audio ohne Untertitel). ' +
				'Nach der ersten erfolgreichen Verbindung wird hier automatisch ein Dropdown mit den echten Channels angeboten.',
			width: 6,
			default: 'auto',
		}
	}

	return {
		type: 'dropdown',
		id: 'preferredChannelId',
		label: 'Bevorzugter Import-Channel',
		tooltip: 'Standard-Channel für Actions/Feedbacks mit Channel-Option "Auto / Quellkanal".',
		width: 6,
		choices: [
			{ id: 'auto', label: 'Auto / Quellkanal' },
			...knownChannels.map((channel) => ({ id: String(channel.id), label: `${channel.name} (${channel.id})` })),
		],
		default: 'auto',
	}
}

export function GetConfigFields(knownChannels: LiveVoiceChannel[] = []): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'LiveVoice',
			width: 12,
			value:
				'Verbindet sich direkt mit der internen LiveVoice-Webclient-Schnittstelle (HTTP + ActionCable-WebSocket), ' +
				'ohne Browser. Der <b>Operator-Link</b> wird beim Verbinden automatisch nach Auth-Daten und Channels durchsucht - ' +
				'API-Key, Client-ID, Join-Code etc. müssen nicht manuell eingetragen werden.',
		},
		{
			type: 'secret-text',
			id: 'operatorUrl',
			label: 'Operator-Link',
			tooltip:
				'Der vollständige LiveVoice-Operator-Link, z.B. https://livevoice.io/de/events/operator/<token>. ' +
				'Wird wie ein Zugangsdaten-Geheimnis behandelt und nicht vollständig geloggt.',
			width: 12,
		},
		preferredChannelField(knownChannels),
		{
			type: 'checkbox',
			id: 'debugLogging',
			label: 'Debug-Logging',
			tooltip: 'Protokolliert Discovery/Auth/ActionCable-Details (Ping/Pong, State-Änderungen) auf Debug-Level.',
			width: 6,
			default: false,
		},
	]
}
