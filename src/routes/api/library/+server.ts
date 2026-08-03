import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getLibraryTimeline } from '$lib/server/queries/library';
import { parseCountMode, parseLibraryFilters } from '$lib/server/queries/params';

/** Additions-timeline pages, fetched as the user scrolls. */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.account) error(401, 'Not signed in');

	const page = await getLibraryTimeline(
		locals.account.id,
		parseCountMode(url.searchParams),
		locals.timeZone,
		{
			...parseLibraryFilters(url.searchParams, locals.timeZone, locals.serverScope),
			cursor: url.searchParams.get('cursor') ?? undefined,
			limit: Math.min(Number(url.searchParams.get('limit')) || 60, 200)
		}
	);

	return json(page);
};
