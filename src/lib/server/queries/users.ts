/**
 * The people whose activity can be shown.
 *
 * Only servers you own report more than one, since `/accounts` is admin-only —
 * on a shared server the list is just you.
 */

import { and, desc, eq, gt, inArray, or } from 'drizzle-orm';
import { db } from '../db';
import { serverAccounts, servers } from '../db/schema';

export interface Viewer {
	/** `serverId:serverAccountId` — the value the picker round-trips. */
	id: string;
	serverId: string;
	serverName: string;
	accountId: number;
	name: string;
	thumb: string | null;
	isSelf: boolean;
	historyCount: number;
}

export async function getViewers(accountId: number, serverIds: string[] = []): Promise<Viewer[]> {
	const rows = await db
		.select({
			serverId: serverAccounts.serverId,
			serverName: servers.name,
			accountId: serverAccounts.accountId,
			name: serverAccounts.name,
			thumb: serverAccounts.thumb,
			isSelf: serverAccounts.isSelf,
			historyCount: serverAccounts.historyCount
		})
		.from(serverAccounts)
		.innerJoin(servers, eq(servers.clientIdentifier, serverAccounts.serverId))
		.where(
			and(
				eq(servers.accountId, accountId),
				serverIds.length ? inArray(serverAccounts.serverId, serverIds) : undefined,
				// An account that exists but has never watched anything is noise in a
				// picker — except your own, which must always be selectable.
				or(eq(serverAccounts.isSelf, true), gt(serverAccounts.historyCount, 0))
			)
		)
		.orderBy(desc(serverAccounts.isSelf), desc(serverAccounts.historyCount));

	return rows.map((row) => ({
		id: `${row.serverId}:${row.accountId}`,
		serverId: row.serverId,
		serverName: row.serverName,
		accountId: row.accountId,
		name: row.name ?? `Account ${row.accountId}`,
		thumb: row.thumb,
		isSelf: row.isSelf,
		historyCount: Number(row.historyCount)
	}));
}
