import { describe, expect, it } from 'vitest'
import { buildImportActionFrame, buildPongFrame, buildSubscribeFrame } from '../livevoice-client.js'

describe('ActionCable frame encoding', () => {
	it('encodes start_importing with identifier/data as JSON-encoded strings, not nested objects', () => {
		const frame = buildImportActionFrame(125145, 'start_importing')

		expect(frame).toBe(
			'{"command":"message","identifier":"{\\"channel\\":\\"V2Channel\\"}","data":"{\\"channel_id\\":125145,\\"action\\":\\"start_importing\\"}"}',
		)

		const outer = JSON.parse(frame) as { command: string; identifier: string; data: string }
		expect(typeof outer.identifier).toBe('string')
		expect(typeof outer.data).toBe('string')
		expect(JSON.parse(outer.identifier)).toEqual({ channel: 'V2Channel' })
		expect(JSON.parse(outer.data)).toEqual({ channel_id: 125145, action: 'start_importing' })
	})

	it('encodes stop_importing the same way', () => {
		const frame = buildImportActionFrame(125145, 'stop_importing')
		const outer = JSON.parse(frame) as { data: string }
		expect(JSON.parse(outer.data)).toEqual({ channel_id: 125145, action: 'stop_importing' })
	})

	it('encodes the subscribe frame', () => {
		const frame = buildSubscribeFrame()
		expect(JSON.parse(frame)).toEqual({ command: 'subscribe', identifier: '{"channel":"V2Channel"}' })
	})

	it('encodes the pong frame', () => {
		expect(JSON.parse(buildPongFrame())).toEqual({ command: 'pong' })
	})
})
