import type { Handle } from '@sveltejs/kit';
import { resolveSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { TIMEZONE_COOKIE, isValidTimeZone } from '$lib/server/timezone';
import {
	ALL_SERVERS,
	ALL_USERS,
	getServerScope,
	getUserScope,
	setServerScope,
	setUserScope
} from '$lib/server/preferences';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.account = await resolveSession(event.cookies.get(SESSION_COOKIE));

	// The client writes this cookie on first paint (see +layout.svelte). Until it
	// does — and for the very first request of a new browser — the server's own
	// zone stands in, which is right for the common self-hosted case.
	const cookieZone = event.cookies.get(TIMEZONE_COOKIE);
	event.locals.timeZone = isValidTimeZone(cookieZone)
		? cookieZone
		: (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');

	/*
	 * Server scope, resolved once per request so every page and endpoint agrees.
	 *
	 * An explicit `?server=` wins and is remembered; its absence means "use what
	 * I picked last time". That's why "all servers" needs its own sentinel rather
	 * than an empty parameter — an empty parameter is indistinguishable from not
	 * having said anything, and would make "all" impossible to choose.
	 */
	event.locals.serverScope = [];
	if (event.locals.account) {
		const requested = event.url.searchParams.get('server');

		if (requested === ALL_SERVERS) {
			event.locals.serverScope = [];
			await setServerScope(event.locals.account.id, null);
		} else if (requested) {
			event.locals.serverScope = [requested];
			await setServerScope(event.locals.account.id, requested);
		} else {
			event.locals.serverScope = await getServerScope(event.locals.account.id);
		}
	}

	/*
	 * Viewer scope: whose activity the pages describe.
	 *
	 * Null means the signed-in user, which is what every page showed before this
	 * existed and remains the default. `all` widens to everyone on the server,
	 * which is only ever populated for servers you own — a shared server can't
	 * report anyone else's viewing.
	 */
	event.locals.userScope = null;
	if (event.locals.account) {
		const requested = event.url.searchParams.get('user');

		if (requested === ALL_USERS) {
			event.locals.userScope = 'all';
			await setUserScope(event.locals.account.id, ALL_USERS);
		} else if (requested) {
			event.locals.userScope = requested;
			await setUserScope(event.locals.account.id, requested);
		} else {
			event.locals.userScope = await getUserScope(event.locals.account.id);
		}
	}

	return resolve(event);
};
