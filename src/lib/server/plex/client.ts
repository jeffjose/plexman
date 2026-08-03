/**
 * Low-level Plex HTTP client.
 *
 * Two different hosts are involved and they behave differently:
 *
 *   - plex.tv (`https://plex.tv/api/v2`) — the account API. Handles the PIN
 *     OAuth exchange, the signed-in user, and the list of servers the account
 *     can reach. Speaks JSON if you ask for it.
 *   - a Plex Media Server — the thing that actually holds watch history. Each
 *     server has its own `accessToken` (from the resources call) that is NOT
 *     the account token, and its own set of candidate connection URIs.
 *
 * Both authenticate with `X-Plex-Token` and both want the `X-Plex-*` client
 * identity headers on every request; Plex uses them to name the "device" that
 * shows up in the account's authorized-devices list.
 */

import { PLEX_PRODUCT, PLEX_VERSION, PLEX_PLATFORM, PLEX_DEVICE_NAME } from './constants';

export class PlexError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly url: string,
		readonly body?: string
	) {
		super(message);
		this.name = 'PlexError';
	}
}

export interface PlexHeaderOptions {
	clientId: string;
	token?: string;
}

/**
 * The identity headers Plex expects on every call. `X-Plex-Client-Identifier`
 * is the important one: the PIN created under a given client id can only be
 * claimed by that same client id, and the account's device list is keyed on it.
 * It must therefore be stable across restarts — see `getClientId()` in auth.ts.
 */
export function plexHeaders({ clientId, token }: PlexHeaderOptions): Record<string, string> {
	const headers: Record<string, string> = {
		accept: 'application/json',
		'X-Plex-Product': PLEX_PRODUCT,
		'X-Plex-Version': PLEX_VERSION,
		'X-Plex-Client-Identifier': clientId,
		'X-Plex-Platform': PLEX_PLATFORM,
		'X-Plex-Device-Name': PLEX_DEVICE_NAME,
		'X-Plex-Model': 'hosted'
	};
	if (token) headers['X-Plex-Token'] = token;
	return headers;
}

export interface PlexFetchOptions extends PlexHeaderOptions {
	method?: string;
	searchParams?: Record<string, string | number | undefined>;
	/** Milliseconds before the request is aborted. Servers reached over a dead
	 *  LAN address hang rather than refuse, so every call needs a deadline. */
	timeoutMs?: number;
	body?: BodyInit;
	headers?: Record<string, string>;
}

export async function plexFetch<T>(
	baseUrl: string,
	path: string,
	options: PlexFetchOptions
): Promise<T> {
	const { method = 'GET', searchParams, timeoutMs = 15_000, body, headers: extraHeaders } = options;

	const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
	for (const [key, value] of Object.entries(searchParams ?? {})) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	let response: Response;
	try {
		response = await fetch(url, {
			method,
			body,
			headers: { ...plexHeaders(options), ...extraHeaders },
			signal: controller.signal
		});
	} catch (error) {
		const reason =
			error instanceof Error && error.name === 'AbortError'
				? `timed out after ${timeoutMs}ms`
				: String(error);
		throw new PlexError(`Request to ${url.host} failed: ${reason}`, 0, url.toString());
	} finally {
		clearTimeout(timer);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new PlexError(
			`Plex responded ${response.status} ${response.statusText} for ${url.pathname}`,
			response.status,
			url.toString(),
			text.slice(0, 500)
		);
	}

	// A few PMS endpoints answer 200 with an empty body rather than an empty
	// container; treat that as "no data" instead of a JSON parse crash.
	const text = await response.text();
	if (!text.trim()) return {} as T;

	try {
		return JSON.parse(text) as T;
	} catch {
		throw new PlexError(
			`Plex returned non-JSON for ${url.pathname} (is this a Plex server?)`,
			response.status,
			url.toString(),
			text.slice(0, 200)
		);
	}
}
