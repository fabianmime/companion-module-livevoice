import { describe, expect, it } from 'vitest'
import { mapChannelUpdatedState, mapInitialImportState, selectDefaultImportChannel } from '../livevoice-client.js'
import type { LiveVoiceChannel } from '../types.js'

describe('mapInitialImportState', () => {
	it('maps offline/active/inactive and falls back to unknown', () => {
		expect(mapInitialImportState('offline')).toBe('offline')
		expect(mapInitialImportState('active')).toBe('active')
		expect(mapInitialImportState('inactive')).toBe('inactive')
		expect(mapInitialImportState('something-new')).toBe('unknown')
		expect(mapInitialImportState(undefined)).toBe('unknown')
	})
})

describe('mapChannelUpdatedState', () => {
	it('prefers state_class over markup', () => {
		expect(mapChannelUpdatedState({ state_class: 'active' })).toBe('active')
	})

	it('falls back to settings_markup when state_class is absent', () => {
		expect(
			mapChannelUpdatedState({
				settings_markup: { de: '<a data-action="streaming-channel#stopImporting">Import stoppen</a>' },
			}),
		).toBe('active')

		expect(
			mapChannelUpdatedState({
				settings_markup: { de: '<a data-action="streaming-channel#startImporting">Import starten</a>' },
			}),
		).toBe('inactive')
	})

	it('never invents active/inactive from unrecognised state_class values', () => {
		expect(mapChannelUpdatedState({ state_class: 'connecting' })).toBe('unknown')
	})
})

describe('selectDefaultImportChannel', () => {
	const channels: LiveVoiceChannel[] = [
		{ id: 125145, name: 'Original Audio', hasAudio: true, hasSubtitles: false, isChild: false, importState: 'offline' },
		{ id: 125147, name: 'English', hasAudio: true, hasSubtitles: true, isChild: false, importState: 'offline' },
		{ id: 126435, name: 'Français', hasAudio: true, hasSubtitles: true, isChild: false, importState: 'offline' },
		{ id: 126008, name: 'Українська', hasAudio: true, hasSubtitles: true, isChild: false, importState: 'offline' },
	]

	it('picks the single audio-without-subtitles channel from the observed fixture event', () => {
		expect(selectDefaultImportChannel(channels)?.id).toBe(125145)
	})

	it('returns undefined when no channel has audio', () => {
		expect(selectDefaultImportChannel(channels.map((channel) => ({ ...channel, hasAudio: false })))).toBeUndefined()
	})

	it('falls back to the "Original Audio" name hint when multiple candidates remain', () => {
		const ambiguous: LiveVoiceChannel[] = [
			{ id: 1, name: 'Original Audio', hasAudio: true, hasSubtitles: false, importState: 'offline' },
			{ id: 2, name: 'Also No Subtitles', hasAudio: true, hasSubtitles: false, importState: 'offline' },
		]
		expect(selectDefaultImportChannel(ambiguous)?.id).toBe(1)
	})

	it('gives up when still ambiguous after all heuristics', () => {
		const ambiguous: LiveVoiceChannel[] = [
			{ id: 1, name: 'Channel A', hasAudio: true, hasSubtitles: false, importState: 'offline' },
			{ id: 2, name: 'Channel B', hasAudio: true, hasSubtitles: false, importState: 'offline' },
		]
		expect(selectDefaultImportChannel(ambiguous)).toBeUndefined()
	})

	it('never relies on a fixed channel ID', () => {
		const shuffled = channels.map((channel) => ({ ...channel, id: channel.id + 1_000_000 }))
		expect(selectDefaultImportChannel(shuffled)?.name).toBe('Original Audio')
	})
})
