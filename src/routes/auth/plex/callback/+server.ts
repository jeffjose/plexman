/**
 * Step 2 of the Plex PIN flow: the browser is back from plex.tv, so claim the
 * token, persist the account, and open a session.
 *
 * Server discovery runs here too — it's a single plex.tv call and having the
 * server list ready means the dashboard can offer a sync immediately rather
 * than showing an empty state that needs a second explicit step.
 */

import { redirect, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { accounts } from '$lib/server/db/schema';
import { getClientId, getUser, waitForPinToken, PIN_COOKIE } from '$lib/server/plex/auth';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { syncServers } from '$lib/server/sync/servers';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const pinId = Number(cookies.get(PIN_COOKIE));
	cookies.delete(PIN_COOKIE, { path: '/' });

	if (!Number.isFinite(pinId) || pinId <= 0) {
		redirect(303, '/login?error=missing_pin');
	}

	const clientId = await getClientId();

	let token: string | null;
	try {
		token = await waitForPinToken(clientId, pinId);
	} catch {
		redirect(303, '/login?error=pin_check_failed');
	}

	// No token means the user cancelled on plex.tv, or the PIN expired while the
	// tab sat open — both land back on the login page rather than erroring.
	if (!token) redirect(303, '/login?error=not_authorized');

	const user = await getUser(clientId, token);
	const now = Math.floor(Date.now() / 1000);

	await db
		.insert(accounts)
		.values({
			id: user.id,
			uuid: user.uuid,
			username: user.username,
			title: user.title || user.username,
			email: user.email,
			thumb: user.thumb,
			authToken: token,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: accounts.id,
			set: {
				uuid: user.uuid,
				username: user.username,
				title: user.title || user.username,
				email: user.email,
				thumb: user.thumb,
				authToken: token,
				updatedAt: now
			}
		});

	// Best-effort: a failure here (plex.tv hiccup, no servers shared yet) should
	// not block a sign-in that has otherwise succeeded. The dashboard can retry.
	try {
		await syncServers(clientId, user.id, token);
	} catch (error) {
		console.error('[plexman] server discovery failed during login:', error);
	}

	setSessionCookie(cookies, await createSession(user.id));
	redirect(303, url.searchParams.get('next') ?? '/');
};
