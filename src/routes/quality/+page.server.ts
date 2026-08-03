import { redirect } from '@sveltejs/kit';
import { getSections } from '$lib/server/queries/library';
import {
	getDuplicates,
	getFitReport,
	getQualityOverview,
	getReencodeWorklist,
	parseQualityFilters
} from '$lib/server/queries/quality';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.account) redirect(303, '/login');

	const serverIds = locals.serverScope;
	const filters = parseQualityFilters(url.searchParams, serverIds);

	const [overview, reencode, duplicates, fit, sections] = await Promise.all([
		getQualityOverview(locals.account.id, locals.timeZone, filters),
		getReencodeWorklist(locals.account.id, filters),
		getDuplicates(locals.account.id, filters),
		getFitReport(locals.account.id, filters),
		getSections(locals.account.id, serverIds)
	]);

	return {
		overview,
		reencode,
		duplicates,
		fit,
		// Muted libraries are excluded from every figure on this page, so offering
		// them as filter chips would promise a filter that can only ever return
		// nothing. Unmuting stays where it already lives, on the Library page.
		sections: sections.filter((section) => !section.hidden)
	};
};
