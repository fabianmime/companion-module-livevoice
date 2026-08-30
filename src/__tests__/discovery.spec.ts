import { describe, expect, it } from 'vitest'
import { extractDiscovery } from '../livevoice-client.js'

function fixtureHtml(headersJson: string): string {
	const escaped = headersJson.replace(/"/g, '&quot;')
	return `
		<html>
			<body>
				<div
					data-controller="event-view streaming"
					data-streaming-api-url="https://livevoice.io/api/v2/authenticate?join_code=000000&amp;user_name=Operator+dummy"
					data-streaming-api-headers="${escaped}"
				></div>
			</body>
		</html>
	`
}

describe('extractDiscovery', () => {
	it('reads the auth URL and decodes HTML-entity-escaped JSON headers', () => {
		const headers = {
			'api-key': 'dummy-api-key',
			'client-identifier': 'dummy-client-id',
			'client-operator-token': 'dummy-operator-token',
			'client-role': 'operator',
		}
		const html = fixtureHtml(JSON.stringify(headers))

		const discovery = extractDiscovery(html)

		expect(discovery).toBeDefined()
		expect(discovery?.authUrl).toBe(
			'https://livevoice.io/api/v2/authenticate?join_code=000000&user_name=Operator+dummy',
		)
		expect(discovery?.headers).toEqual(headers)
		expect(discovery?.operatorToken).toBe('dummy-operator-token')
	})

	it('carries forward unknown header keys instead of using a fixed allowlist', () => {
		const headers = { 'api-key': 'x', 'brand-new-header': 'some-value' }
		const html = fixtureHtml(JSON.stringify(headers))

		const discovery = extractDiscovery(html)

		expect(discovery?.headers['brand-new-header']).toBe('some-value')
	})

	it('returns undefined when the streaming data attributes are missing', () => {
		const discovery = extractDiscovery('<html><body><div>no streaming data here</div></body></html>')
		expect(discovery).toBeUndefined()
	})

	it('returns undefined when data-streaming-api-headers is not valid JSON', () => {
		const html = `
			<div
				data-streaming-api-url="https://livevoice.io/api/v2/authenticate?join_code=1"
				data-streaming-api-headers="not-json"
			></div>
		`
		expect(extractDiscovery(html)).toBeUndefined()
	})
})
