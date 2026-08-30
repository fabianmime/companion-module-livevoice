import type { CompanionInputFieldDropdown } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ImportState } from './types.js'

export type FeedbacksSchema = {
	importActive: { type: 'boolean'; options: { channelId: string } }
	importInactive: { type: 'boolean'; options: { channelId: string } }
	importOffline: { type: 'boolean'; options: { channelId: string } }
	importUnknown: { type: 'boolean'; options: { channelId: string } }
	connected: { type: 'boolean'; options: Record<string, never> }
	listenerCountCompare: { type: 'boolean'; options: { channelId: string; comparator: string; value: number } }
}

function channelField(self: ModuleInstance): CompanionInputFieldDropdown<'channelId', string | number> {
	return {
		type: 'dropdown',
		id: 'channelId',
		label: 'Channel',
		choices: self.getChannelActionChoices(),
		default: 'auto',
	}
}

/** Liefert 'unknown', wenn der Channel gar nicht auflösbar ist - so wie bei einem unbekannten Server-State. */
function currentImportState(self: ModuleInstance, channelIdOption: unknown): ImportState {
	const channelId = self.resolveChannelId(typeof channelIdOption === 'string' ? channelIdOption : 'auto')
	if (channelId === undefined) return 'unknown'
	return self.client.getChannel(channelId)?.importState ?? 'unknown'
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		importActive: {
			type: 'boolean',
			name: 'Import ist aktiv',
			description: 'Aktiv, wenn der tatsächliche LiveVoice-Serverstatus des gewählten Channels "active" ist',
			defaultStyle: { bgcolor: 0x00cc00, color: 0xffffff },
			options: [channelField(self)],
			callback: (feedback) => currentImportState(self, feedback.options.channelId) === 'active',
		},
		importInactive: {
			type: 'boolean',
			name: 'Import ist inaktiv',
			description: 'Aktiv, wenn der gewählte Channel eindeutig nicht importiert (inactive/offline)',
			defaultStyle: { bgcolor: 0xc80000, color: 0xffffff },
			options: [channelField(self)],
			callback: (feedback) => {
				const state = currentImportState(self, feedback.options.channelId)
				return state === 'inactive' || state === 'offline'
			},
		},
		importOffline: {
			type: 'boolean',
			name: 'Import ist offline',
			description: 'Aktiv, wenn der gewählte Channel als "offline" gemeldet ist (kein Operator-Link/keine Verbindung)',
			defaultStyle: { bgcolor: 0x626d75, color: 0xffffff },
			options: [channelField(self)],
			callback: (feedback) => currentImportState(self, feedback.options.channelId) === 'offline',
		},
		importUnknown: {
			type: 'boolean',
			name: 'Import-Status unbekannt',
			description: 'Aktiv, wenn der Status des gewählten Channels (noch) nicht eindeutig bestimmbar ist',
			defaultStyle: { bgcolor: 0x626d75, color: 0xffffff },
			options: [channelField(self)],
			callback: (feedback) => currentImportState(self, feedback.options.channelId) === 'unknown',
		},
		connected: {
			type: 'boolean',
			name: 'LiveVoice verbunden',
			description: 'Aktiv, wenn die ActionCable-Verbindung offen und der V2Channel subscribed ist',
			defaultStyle: { bgcolor: 0x00c800, color: 0xffffff },
			options: [],
			callback: () => self.client.isConnected(),
		},
		listenerCountCompare: {
			type: 'boolean',
			name: 'Listener-Anzahl vergleichen',
			description: 'Vergleicht die aktuelle Listener-Anzahl des gewählten Channels mit einem festen Wert',
			defaultStyle: { bgcolor: 0x00c800, color: 0xffffff },
			options: [
				channelField(self),
				{
					type: 'dropdown',
					id: 'comparator',
					label: 'Vergleich',
					choices: [
						{ id: 'eq', label: '=' },
						{ id: 'gt', label: '>' },
						{ id: 'lt', label: '<' },
						{ id: 'gte', label: '>=' },
						{ id: 'lte', label: '<=' },
					],
					default: 'gt',
				},
				{ type: 'number', id: 'value', label: 'Wert', min: 0, max: 100_000, default: 0 },
			],
			callback: (feedback) => {
				const channelId = self.resolveChannelId(String(feedback.options.channelId ?? 'auto'))
				if (channelId === undefined) return false
				const listeners = self.client.getChannel(channelId)?.listeners ?? 0
				const value = Number(feedback.options.value ?? 0)
				switch (feedback.options.comparator) {
					case 'eq':
						return listeners === value
					case 'gt':
						return listeners > value
					case 'lt':
						return listeners < value
					case 'gte':
						return listeners >= value
					case 'lte':
						return listeners <= value
					default:
						return false
				}
			},
		},
	})
}
