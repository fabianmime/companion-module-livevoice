import type { CompanionVariableDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type VariablesSchema = {
	connection_status: string
	event_name: string
	event_id: string
	join_code: string
	import_channel_name: string
	import_channel_id: string
	import_state: string
	listener_count: number
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		connection_status: { name: 'Verbindungsstatus' },
		event_name: { name: 'Event-Name' },
		event_id: { name: 'Event-ID' },
		join_code: { name: 'Join-Code' },
		import_channel_name: { name: 'Import-Channel: Name' },
		import_channel_id: { name: 'Import-Channel: ID' },
		import_state: { name: 'Import-Status (active/inactive/offline/unknown)' },
		listener_count: { name: 'Listener-Anzahl (Import-Channel)' },
	}

	self.setVariableDefinitions(definitions)
}
