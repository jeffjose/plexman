import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { servers } from '$lib/server/db/schema';
import { getViewers } from '$lib/server/queries/users';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	// The server list lives in the layout because the scope selector sits in the
	// nav and applies to both Activity and Library — loading it per page would
	// mean two copies that can disagree mid-navigation.
	const knownServers = locals.account
		? await db
				.select({
					id: servers.clientIdentifier,
					name: servers.name,
					owned: servers.owned
				})
				.from(servers)
				.where(eq(servers.accountId, locals.account.id))
				.orderBy(servers.name)
		: [];

	const viewers = locals.account ? await getViewers(locals.account.id, locals.serverScope) : [];

	return {
		timeZone: locals.timeZone,
		servers: knownServers,
		viewers,
		userScope: locals.userScope,
		// Resolved in hooks from the URL or the stored preference, so the selector
		// shows what's actually being queried rather than what the URL happens to
		// say.
		serverScope: locals.serverScope,
		account: locals.account
			? {
					id: locals.account.id,
					username: locals.account.username,
					title: locals.account.title,
					thumb: locals.account.thumb
				}
			: null
	};
};
