export type ImportState = 'active' | 'inactive' | 'offline' | 'unknown'

export interface LiveVoiceChannel {
	id: number
	name: string
	hasAudio?: boolean
	hasSubtitles?: boolean
	isChild?: boolean
	stateType?: string
	stateClass?: string
	listeners?: number
	importState: ImportState
}

export interface LiveVoiceEventState {
	eventId?: number
	name?: string
	joinCode?: string
	listenerShareUrl?: string
	channels: Map<number, LiveVoiceChannel>
}

/** Aus dem Operator-HTML extrahierte Verbindungsdaten (siehe INFO.md Abschnitt 2-4). */
export interface LiveVoiceDiscovery {
	authUrl: string
	headers: Record<string, string>
	operatorToken?: string
}
