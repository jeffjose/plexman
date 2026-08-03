import { redirect } from '@sveltejs/kit';
import { getLibrarySummary, getLibraryTimeline, getSections } from '$lib/server/queries/library';
import { parseCountMode, parseLibraryFilters } from '$lib/server/queries/params';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.account) redirect(303, '/login');

	const mode = parseCountMode(url.searchParams);
	const filters = parseLibraryFilters(url.searchParams, locals.timeZone, locals.serverScope);

	// As on Activity: picking a day narrows the list below but not the calendar,
	// which would otherwise collapse to the single cell just clicked.
	const summaryFilters = url.searchParams.has('day')
		? { ...filters, from: undefined, to: undefined }
		: filters;

	const [summary, timeline, sections] = await Promise.all([
		getLibrarySummary(locals.account.id, locals.timeZone, mode, summaryFilters),
		getLibraryTimeline(locals.account.id, mode, locals.timeZone, { ...filters, limit: 60 }),
		getSections(locals.account.id, locals.serverScope)
	]);

	return { summary, timeline, sections, mode };
};
