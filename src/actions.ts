import type { CompanionInputFieldDropdown } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type ActionsSchema = {
	startImport: { options: { channelId: string } }
	stopImport: { options: { channelId: string } }
	toggleImport: { options: { channelId: string } }
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

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		startImport: {
			name: 'Import starten',
			description: 'Startet den Audio-Import für den gewählten Channel',
			options: [channelField(self)],
			callback: async (action) => {
				const channelId = self.resolveChannelId(String(action.options.channelId ?? 'auto'))
				if (channelId === undefined) {
					self.log('warn', 'Import starten: kein gültiger Channel ermittelbar')
					return
				}
				await self.startImport(channelId)
			},
		},
		stopImport: {
			name: 'Import stoppen',
			description: 'Stoppt den Audio-Import für den gewählten Channel',
			options: [channelField(self)],
			callback: async (action) => {
				const channelId = self.resolveChannelId(String(action.options.channelId ?? 'auto'))
				if (channelId === undefined) {
					self.log('warn', 'Import stoppen: kein gültiger Channel ermittelbar')
					return
				}
				await self.stopImport(channelId)
			},
		},
		toggleImport: {
			name: 'Import umschalten',
			description:
				'Schaltet den Import um, basierend auf dem tatsächlichen LiveVoice-Serverstatus - nicht auf dem zuletzt ' +
				'gesendeten Befehl. Bei unbekanntem Status wird die Aktion abgelehnt statt blind umzuschalten.',
			options: [channelField(self)],
			callback: async (action) => {
				const channelId = self.resolveChannelId(String(action.options.channelId ?? 'auto'))
				if (channelId === undefined) {
					self.log('warn', 'Import umschalten: kein gültiger Channel ermittelbar')
					return
				}
				await self.toggleImport(channelId)
			},
		},
	})
}
