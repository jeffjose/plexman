import { redirect } from '@sveltejs/kit';
import { getHomeData } from '$lib/server/queries/home';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.account) redirect(303, '/login');

	return {
		home: await getHomeData(locals.account.id, locals.timeZone, {
			serverIds: locals.serverScope,
			viewer: locals.userScope
		})
	};
};
