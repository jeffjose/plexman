import { redirect } from '@sveltejs/kit';
import { getHomeData } from '$lib/server/queries/home';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.account) redirect(303, '/login');

	/*
	 * `url` is read purely to declare the dependency.
	 *
	 * Scope is resolved in hooks and arrives on `locals`, so nothing here would
	 * otherwise touch the URL — and a load that reads no URL property is never
	 * re-run when only the query string changes. Selecting a different server or
	 * user would update the address bar and nothing else.
	 */
	url.searchParams.get('server');
	url.searchParams.get('user');

	return {
		home: await getHomeData(locals.account.id, locals.timeZone, {
			serverIds: locals.serverScope,
			viewer: locals.userScope
		})
	};
};
