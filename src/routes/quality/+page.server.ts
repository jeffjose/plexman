import { redirect } from '@sveltejs/kit';
import { getSections } from '$lib/server/queries/library';
import { parseServerScope } from '$lib/server/queries/params';
import {
	getDuplicates,
	getQualityOverview,
	getReencodeWorklist,
	parseQualityFilters
} from '$lib/server/queries/quality';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.account) redirect(303, '/login');

	const serverIds = parseServerScope(url.searchParams);
	const filters = parseQualityFilters(url.searchParams, serverIds);

	const [overview, reencode, duplicates, sections] = await Promise.all([
		getQualityOverview(locals.account.id, locals.timeZone, filters),
		getReencodeWorklist(locals.account.id, filters),
		getDuplicates(locals.account.id, filters),
		getSections(locals.account.id, serverIds)
	]);

	return {
		overview,
		reencode,
		duplicates,
		// Muted libraries are excluded from every figure on this page, so offering
		// them as filter chips would promise a filter that can only ever return
		// nothing. Unmuting stays where it already lives, on the Library page.
		sections: sections.filter((section) => !section.hidden)
	};
};
