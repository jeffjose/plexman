/**
 * Step 1 of the Plex PIN flow: mint a PIN and bounce the browser to plex.tv.
 *
 * The pin id is stashed in a short-lived cookie because the return trip carries
 * no identifying parameter of its own (see plex/auth.ts) — the cookie is the
 * only thing linking the redirect back to the PIN we created.
 */

import { redirect, type RequestHandler } from '@sveltejs/kit';
import { buildAuthUrl, createPin, getClientId, PIN_COOKIE } from '$lib/server/plex/auth';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const clientId = await getClientId();
	const pin = await createPin(clientId);

	cookies.set(PIN_COOKIE, String(pin.id), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		// Plex expires the PIN itself in ~15 minutes; matching that means an
		// abandoned sign-in leaves nothing behind.
		maxAge: 15 * 60
	});

	const forwardUrl = new URL('/auth/plex/callback', url.origin).toString();
	redirect(303, buildAuthUrl({ clientId, code: pin.code, forwardUrl }));
};
