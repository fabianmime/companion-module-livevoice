import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFollowingRedirectsWithCookies } from '../livevoice-client.js'

/**
 * Regression test for a real bug found against the live LiveVoice operator link: the operator URL 302s to a
 * canonical short URL and sets a session cookie on that first response. A plain `fetch(url, { redirect: 'follow' })`
 * loses that cookie on the automatic redirect (Node's fetch has no cookie jar), so the second hop comes back
 * HTTP 404 even though the same link works fine in a browser. `fetchFollowingRedirectsWithCookies` must follow
 * redirects manually and re-attach every cookie seen so far on each subsequent hop.
 */
describe('fetchFollowingRedirectsWithCookies', () => {
	const originalFetch = global.fetch

	beforeEach(() => {
		vi.restoreAllMocks()
	})

	afterEach(() => {
		global.fetch = originalFetch
	})

	function headersWithSetCookie(setCookies: string[], extra: Record<string, string> = {}): Headers {
		const headers = new Headers(extra)
		for (const cookie of setCookies) headers.append('set-cookie', cookie)
		return headers
	}

	it('forwards cookies set on a redirect hop to the next request', async () => {
		const calls: Array<{ url: string; cookieHeader: string | null }> = []

		global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
			const cookieHeader = new Headers(init?.headers).get('cookie')
			calls.push({ url: String(url), cookieHeader })

			if (calls.length === 1) {
				return new Response(null, {
					status: 302,
					headers: headersWithSetCookie(['session=abc123; path=/; httponly', 'user_uuid_private=uuid-1; path=/'], {
						location: 'https://livevoice.io/de/events/operator/short',
					}),
				})
			}

			return new Response('<html>ok</html>', { status: 200 })
		}) as unknown as typeof fetch

		const response = await fetchFollowingRedirectsWithCookies(
			'https://livevoice.io/de/events/operator/full-token',
			new AbortController().signal,
		)

		expect(response.status).toBe(200)
		expect(calls).toHaveLength(2)
		expect(calls[0].cookieHeader).toBeNull()
		expect(calls[1].url).toBe('https://livevoice.io/de/events/operator/short')
		expect(calls[1].cookieHeader).toContain('session=abc123')
		expect(calls[1].cookieHeader).toContain('user_uuid_private=uuid-1')
	})

	it('returns the response as-is when there is no redirect', async () => {
		global.fetch = vi.fn(async () => new Response('<html>direct</html>', { status: 200 }))

		const response = await fetchFollowingRedirectsWithCookies('https://livevoice.io/x', new AbortController().signal)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('<html>direct</html>')
	})

	it('gives up after too many redirects instead of looping forever', async () => {
		global.fetch = vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: 'https://livevoice.io/de/events/operator/loop' },
				}),
		)

		await expect(
			fetchFollowingRedirectsWithCookies('https://livevoice.io/de/events/operator/loop', new AbortController().signal),
		).rejects.toThrow(/Redirects/)
	})
})
