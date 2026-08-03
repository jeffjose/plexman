import type { Handle } from '@sveltejs/kit';
import { resolveSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { TIMEZONE_COOKIE, isValidTimeZone } from '$lib/server/timezone';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.account = await resolveSession(event.cookies.get(SESSION_COOKIE));

	// The client writes this cookie on first paint (see +layout.svelte). Until it
	// does — and for the very first request of a new browser — the server's own
	// zone stands in, which is right for the common self-hosted case.
	const cookieZone = event.cookies.get(TIMEZONE_COOKIE);
	event.locals.timeZone = isValidTimeZone(cookieZone)
		? cookieZone
		: (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');

	return resolve(event);
};
