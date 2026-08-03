import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getTimeline } from '$lib/server/queries/activity';
import { parseActivityFilters } from '$lib/server/queries/params';

/** Timeline pages, fetched as the user scrolls. */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.account) error(401, 'Not signed in');

	const page = await getTimeline(locals.account.id, {
		...parseActivityFilters(
			url.searchParams,
			locals.timeZone,
			locals.serverScope,
			locals.userScope
		),
		cursor: url.searchParams.get('cursor') ?? undefined,
		limit: Math.min(Number(url.searchParams.get('limit')) || 50, 200)
	});

	return json(page);
};
