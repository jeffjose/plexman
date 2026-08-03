/**
 * Poster proxy.
 *
 * Plex artwork can't be linked directly from the page: the URLs are on the
 * media server (often a LAN address the browser can't reach) and every one of
 * them needs an `X-Plex-Token`. Putting that token in an `<img src>` would leak
 * it into the DOM, browser history and any referrer, so images are fetched
 * server-side and streamed back.
 *
 * Requests go through Plex's photo transcoder so the browser gets a thumbnail
 * rather than a full-size poster for every timeline row.
 */

import { error, type RequestHandler } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { servers } from '$lib/server/db/schema';
import { plexHeaders } from '$lib/server/plex/client';
import { getClientId } from '$lib/server/plex/auth';

export const GET: RequestHandler = async ({ locals, url, fetch }) => {
	if (!locals.account) error(401, 'Not signed in');

	const serverId = url.searchParams.get('server');
	const path = url.searchParams.get('path');
	if (!serverId || !path) error(400, 'server and path are required');

	// Only ever a server-relative art path. Without this check the parameter is
	// an open proxy: an absolute URL here would make our server fetch anything
	// the caller names, with our credentials attached.
	if (!path.startsWith('/') || path.startsWith('//')) error(400, 'path must be server-relative');

	const [server] = await db
		.select()
		.from(servers)
		.where(and(eq(servers.clientIdentifier, serverId), eq(servers.accountId, locals.account.id)))
		.limit(1);

	if (!server?.baseUrl) error(404, 'Unknown or unreachable server');

	const width = clampDimension(url.searchParams.get('w'), 300);
	const height = clampDimension(url.searchParams.get('h'), 450);

	const target = new URL('photo/:/transcode', `${server.baseUrl}/`);
	target.searchParams.set('width', String(width));
	target.searchParams.set('height', String(height));
	target.searchParams.set('minSize', '1');
	target.searchParams.set('upscale', '1');
	target.searchParams.set('url', path);

	const clientId = await getClientId();

	let response: Response;
	try {
		response = await fetch(target, {
			headers: { ...plexHeaders({ clientId, token: server.accessToken }), accept: 'image/*' },
			signal: AbortSignal.timeout(10_000)
		});
	} catch {
		error(502, 'Could not reach Plex server for artwork');
	}

	if (!response.ok || !response.body)
		error(response.ok ? 502 : response.status, 'Artwork unavailable');

	return new Response(response.body, {
		headers: {
			'content-type': response.headers.get('content-type') ?? 'image/jpeg',
			// Posters are immutable for a given rating key; caching privately keeps
			// scrolling back through the timeline from re-hitting the Plex server.
			'cache-control': 'private, max-age=86400'
		}
	});
};

function clampDimension(raw: string | null, fallback: number): number {
	const value = Number(raw);
	if (!Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.round(value), 16), 1200);
}
