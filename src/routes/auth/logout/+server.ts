import { redirect, type RequestHandler } from '@sveltejs/kit';
import { clearSessionCookie, destroySession, SESSION_COOKIE } from '$lib/server/auth/session';

/**
 * Ends the local session only. The Plex auth token stays valid — revoking it is
 * done from plex.tv's authorized-devices list, and silently killing it here
 * would be surprising.
 */
export const POST: RequestHandler = async ({ cookies }) => {
	await destroySession(cookies.get(SESSION_COOKIE));
	clearSessionCookie(cookies);
	redirect(303, '/login');
};
