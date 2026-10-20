import { error, type RequestHandler } from '@sveltejs/kit';
import { getClientId } from '#lib/server/plex/auth.js';
import { lightSync } from '#lib/server/sync/light.js';

/**
 * The polled sync: live sessions, new history, and any library whose change
 * counter moved. Sub-second when nothing happened, which is most of the time.
 *
 * Separate from `/api/sync` rather than a mode flag on it, because they answer
 * different questions and a caller should have to choose. `/api/sync` is "bring
 * everything into line, I'll wait"; this is "has anything happened?".
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.account) error(401, 'Not signed in');

	const clientId = await getClientId();
	return Response.json(await lightSync(locals.account, clientId));
};
