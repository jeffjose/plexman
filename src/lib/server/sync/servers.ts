/**
 * Reconciles the account's server list from plex.tv into the local database.
 *
 * Run at login and on demand. Per-server access tokens are refreshed here too:
 * they can be rotated by Plex (for example when a share is changed), and a
 * stale one produces 401s that look like a sync bug.
 */

import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { history, servers } from '../db/schema';
import { getResources, isMediaServer, rankConnections } from '../plex/auth';

export async function syncServers(
	clientId: string,
	accountId: number,
	authToken: string
): Promise<number> {
	/*
	 * Only servers this account owns.
	 *
	 * A server merely shared with you is someone else's box: `/accounts` is
	 * admin-only there so it answers 403, and the handful of things you watched
	 * on it isn't worth a permanently-failing sync target in the UI. Drop the
	 * shared ones on discovery so they never become one.
	 */
	const resources = (await getResources(clientId, authToken))
		.filter(isMediaServer)
		.filter((resource) => resource.owned);

	const now = Math.floor(Date.now() / 1000);
	let stored = 0;

	for (const resource of resources) {
		const connections = rankConnections(resource);
		// A server with no access token or no addresses can't be queried; keeping
		// it would just produce a permanently failing sync target.
		if (!resource.accessToken || connections.length === 0) continue;

		await db
			.insert(servers)
			.values({
				clientIdentifier: resource.clientIdentifier,
				accountId,
				name: resource.name,
				product: resource.product,
				version: resource.productVersion,
				owned: resource.owned,
				accessToken: resource.accessToken,
				connections: connections.join('\n'),
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: servers.clientIdentifier,
				set: {
					accountId,
					name: resource.name,
					product: resource.product,
					version: resource.productVersion,
					owned: resource.owned,
					accessToken: resource.accessToken,
					connections: connections.join('\n'),
					updatedAt: now
				}
			});
		stored++;
	}

	await pruneEmptyServers(
		accountId,
		resources.map((resource) => resource.clientIdentifier)
	);

	return stored;
}

/**
 * Forgets servers that discovery no longer returns — but only ones holding no
 * history.
 *
 * Without this, a server that stops qualifying (un-shared, or excluded by the
 * owned-only rule above) lingers in the list forever showing a stale sync
 * error. The empty-only condition is the safety catch: `history.serverId`
 * cascades on delete, so pruning a server with rows would destroy watch history
 * over what might be nothing worse than a plex.tv hiccup.
 */
async function pruneEmptyServers(accountId: number, keep: string[]): Promise<void> {
	const stale = await db
		.select({ id: servers.clientIdentifier })
		.from(servers)
		.where(and(eq(servers.accountId, accountId), notInArray(servers.clientIdentifier, keep)));

	for (const { id } of stale) {
		const [row] = await db
			.select({ n: sql<number>`count(*)` })
			.from(history)
			.where(eq(history.serverId, id));

		if (Number(row?.n ?? 0) === 0) {
			await db.delete(servers).where(eq(servers.clientIdentifier, id));
		}
	}
}

export async function listServers(accountId: number) {
	return db.select().from(servers).where(eq(servers.accountId, accountId));
}
