import { error, json, type RequestHandler } from '@sveltejs/kit';
import { setSectionHidden } from '$lib/server/queries/library';

/**
 * Mutes or unmutes a library.
 *
 * A standing preference, so it lives in the database rather than the URL —
 * "stop showing me YouTube" should still hold next time the page is opened.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.account) error(401, 'Not signed in');

	const body = (await request.json().catch(() => null)) as {
		serverId?: string;
		sectionKey?: string;
		hidden?: boolean;
	} | null;

	if (!body?.serverId || !body?.sectionKey || typeof body.hidden !== 'boolean') {
		error(400, 'serverId, sectionKey and hidden are required');
	}

	const ok = await setSectionHidden(locals.account.id, body.serverId, body.sectionKey, body.hidden);
	if (!ok) error(404, 'Unknown library');

	return json({ ok: true });
};
