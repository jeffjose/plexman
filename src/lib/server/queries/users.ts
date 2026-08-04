/**
 * The people whose activity can be shown.
 *
 * Only servers you own report more than one, since `/accounts` is admin-only —
 * on a shared server the list is just you.
 */

import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
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
				/*
				 * Everyone the server knows about, including people with no plays on
				 * record — a share you've granted is worth seeing even when it's
				 * unused, and "nobody has watched anything" is itself an answer.
				 *
				 * Account 0 is the exception: Plex reports it as an unnamed
				 * pseudo-account rather than a person, and selecting it would filter
				 * to nothing.
				 */
				gt(serverAccounts.accountId, 0)
			)
		)
		// Most active first, then alphabetical, so the people you'd actually pick
		// lead and the rest stay findable.
		.orderBy(desc(serverAccounts.historyCount), asc(serverAccounts.name));

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
