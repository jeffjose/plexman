/**
 * Plex OAuth, which is a PIN exchange rather than a classic redirect grant:
 *
 *   1. POST /pins            → { id, code }
 *   2. send the browser to app.plex.tv/auth#?clientID=…&code=…&forwardUrl=…
 *   3. user signs in on plex.tv, browser comes back to forwardUrl
 *   4. GET /pins/:id         → { authToken } once the code has been claimed
 *
 * Note what step 3 does *not* carry: the redirect back to `forwardUrl` includes
 * no code, no state, nothing. The pin id is the only link between the two
 * halves of the flow, so it has to be stashed server-side (in a short-lived
 * cookie here) before the redirect and read back afterwards.
 */

import { randomUUID } from 'node:crypto';
import {
	PLEX_AUTH_APP,
	PLEX_PRODUCT,
	PLEX_TV_API,
	PLEX_DEVICE_NAME,
	PLEX_PLATFORM
} from './constants';
import { plexFetch } from './client';
import type { PlexPin, PlexResource, PlexUser } from './types';
import { getSetting, setSetting } from '../db/settings';

/**
 * Carries the in-flight PIN id across the round trip to plex.tv. Lives here
 * rather than in the route because a `+server.ts` may only export HTTP verbs,
 * and both halves of the flow need the same name.
 */
export const PIN_COOKIE = 'plexman_pin';

/**
 * The client identifier Plex ties our PINs and device registration to.
 *
 * Persisted in the database rather than generated per-process: a fresh id on
 * every restart would orphan a device entry in the user's Plex account each
 * time, and would invalidate any PIN that was mid-flight across a dev reload.
 */
export async function getClientId(): Promise<string> {
	const existing = await getSetting('plex_client_id');
	if (existing) return existing;

	const clientId = randomUUID();
	await setSetting('plex_client_id', clientId);
	return clientId;
}

export async function createPin(clientId: string): Promise<PlexPin> {
	return plexFetch<PlexPin>(PLEX_TV_API, 'pins', {
		clientId,
		method: 'POST',
		searchParams: { strong: 'true' }
	});
}

/**
 * Builds the URL the user is sent to in order to approve the PIN.
 *
 * The parameters live in the URL *fragment*, not the query string — app.plex.tv
 * is a client-side app and reads them from `location.hash`. Putting them in the
 * query string produces a page that loads and then does nothing.
 */
export function buildAuthUrl(options: {
	clientId: string;
	code: string;
	forwardUrl: string;
}): string {
	const params = new URLSearchParams({
		clientID: options.clientId,
		code: options.code,
		forwardUrl: options.forwardUrl,
		'context[device][product]': PLEX_PRODUCT,
		'context[device][deviceName]': PLEX_DEVICE_NAME,
		'context[device][platform]': PLEX_PLATFORM
	});
	return `${PLEX_AUTH_APP}#?${params.toString()}`;
}

export async function checkPin(clientId: string, pinId: number): Promise<PlexPin> {
	return plexFetch<PlexPin>(PLEX_TV_API, `pins/${pinId}`, { clientId });
}

/**
 * Polls a PIN until Plex reports it claimed.
 *
 * Called on the way back from the redirect, when the user has already signed
 * in, so the token is normally there on the first or second try. The loop only
 * covers the gap between plex.tv redirecting the browser and plex.tv's own API
 * reflecting the claim, which is short — hence the tight budget.
 */
export async function waitForPinToken(
	clientId: string,
	pinId: number,
	{ attempts = 10, intervalMs = 600 } = {}
): Promise<string | null> {
	for (let attempt = 0; attempt < attempts; attempt++) {
		const pin = await checkPin(clientId, pinId);
		if (pin.authToken) return pin.authToken;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return null;
}

export async function getUser(clientId: string, token: string): Promise<PlexUser> {
	return plexFetch<PlexUser>(PLEX_TV_API, 'user', { clientId, token });
}

/**
 * Servers (and other devices) the account can reach.
 *
 * `includeHttps` asks Plex to hand back the `*.plex.direct` hostnames whose
 * certificates actually validate; without it the connection URIs are bare IPs
 * that fail TLS. `includeRelay` adds Plex's own relay as a last-resort
 * connection for servers with no reachable direct address.
 */
export async function getResources(clientId: string, token: string): Promise<PlexResource[]> {
	const resources = await plexFetch<PlexResource[]>(PLEX_TV_API, 'resources', {
		clientId,
		token,
		searchParams: { includeHttps: 1, includeRelay: 1 },
		timeoutMs: 20_000
	});
	return Array.isArray(resources) ? resources : [];
}

export function isMediaServer(resource: PlexResource): boolean {
	return resource.provides.split(',').includes('server');
}

/**
 * Orders a server's connection URIs best-first.
 *
 * Local addresses are fastest when we're on the same network and simply time
 * out when we're not, so they lead but are not the only option. Relay is last:
 * it works almost everywhere but is bandwidth-limited by Plex, and pulling
 * thousands of history rows through it is slow.
 */
export function rankConnections(resource: PlexResource): string[] {
	const connections = resource.connections ?? [];
	const score = (connection: (typeof connections)[number]) => {
		if (connection.relay) return 3;
		if (connection.local) return 0;
		return 1;
	};
	return [...connections]
		.sort((a, b) => score(a) - score(b))
		.map((connection) => connection.uri)
		.filter(Boolean);
}
