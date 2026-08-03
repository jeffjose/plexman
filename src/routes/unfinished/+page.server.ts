import { redirect } from '@sveltejs/kit';
import { getUnfinished } from '$lib/server/queries/unfinished';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.account) redirect(303, '/login');

	// The whole page is one rollup: the three views are three slices of the same
	// library-versus-history comparison, and running them separately would mean
	// scanning the library three times to produce numbers that must agree.
	const unfinished = await getUnfinished(locals.account.id, locals.timeZone, locals.serverScope);

	return { unfinished };
};
