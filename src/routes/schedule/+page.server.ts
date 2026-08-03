import { redirect } from '@sveltejs/kit';
import { getSchedule, isScheduleFilter } from '$lib/server/queries/schedule';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.account) redirect(303, '/login');

	const requested = url.searchParams.get('only');

	const report = await getSchedule(locals.account.id, locals.timeZone, {
		serverIds: locals.serverScope,
		// A collection kept deliberately partial reads as thousands of gaps, which
		// drowns the real ones — so seasons you hold nothing of stay out unless
		// explicitly asked for.
		heldSeasonsOnly: url.searchParams.get('seasons') !== 'all',
		showRatingKey: url.searchParams.get('show') ?? undefined
	});

	return {
		report,
		filter: requested && isScheduleFilter(requested) ? requested : 'all',
		showRatingKey: url.searchParams.get('show') ?? null,
		allSeasons: url.searchParams.get('seasons') === 'all'
	};
};
