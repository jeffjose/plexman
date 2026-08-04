import { redirect } from '@sveltejs/kit';
import { getUnfinished } from '$lib/server/queries/unfinished';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.account) redirect(303, '/login');

	// Declares the URL dependency so a scope change re-runs this load; the scope
	// itself comes from `locals`. See the note in +layout.server.ts.
	url.searchParams.get('server');
	url.searchParams.get('user');

	// The whole page is one rollup: the three views are three slices of the same
	// library-versus-history comparison, and running them separately would mean
	// scanning the library three times to produce numbers that must agree.
	const unfinished = await getUnfinished(locals.account.id, locals.timeZone, locals.serverScope);

	return { unfinished };
};
