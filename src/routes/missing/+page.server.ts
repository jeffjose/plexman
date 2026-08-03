import { redirect } from '@sveltejs/kit';
import { getMissingReport, type MissingWindow } from '$lib/server/queries/missing';
import { parseServerScope } from '$lib/server/queries/params';
import type { PageServerLoad } from './$types';

/**
 * How far back the list reaches. Sixty days by default: past that the answer
 * stops being "download this" and starts being an inventory of a collection
 * that was never meant to be complete.
 */
function parseWindow(params: URLSearchParams): MissingWindow {
	const since = params.get('since');
	if (since === 'all') return null;
	if (since === '365') return 365;
	return 60;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.account) redirect(303, '/login');

	const missing = await getMissingReport(locals.account.id, locals.timeZone, {
		serverIds: parseServerScope(url.searchParams),
		windowDays: parseWindow(url.searchParams),
		// Off only when explicitly asked for: a collection kept deliberately
		// partial reads as thousands of gaps, which drowns the real ones.
		heldSeasonsOnly: url.searchParams.get('seasons') !== 'all'
	});

	return { missing };
};
