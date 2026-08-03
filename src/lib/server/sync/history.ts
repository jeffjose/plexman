/**
 * Pulls watch history from every reachable server into SQLite.
 *
 * Incremental by design: each server remembers the newest `viewedAt` already
 * stored and asks Plex only for entries after it. The first run walks the full
 * history (which for a long-lived server can be tens of thousands of rows);
 * later runs normally fetch a single short page.
 */

import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { history, servers, type NewHistoryRow, type Server, type Account } from '../db/schema';
import {
	fetchHistoryPage,
	getServerAccounts,
	matchServerAccount,
	resolveBaseUrl,
	type ServerTarget
} from '../plex/server';
import { HISTORY_PAGE_SIZE } from '../plex/constants';
import type { PlexServerAccount } from '../plex/types';
import { serverAccounts } from '../db/schema';
import type { PlexHistoryEntry } from '../plex/types';

export interface ServerSyncResult {
	serverId: string;
	serverName: string;
	inserted: number;
	scanned: number;
	/** Entries Plex returned with a timestamp that can't be real. See
	 *  `isPlausibleViewedAt`. */
	skipped: number;
	error: string | null;
}

export interface SyncResult {
	servers: ServerSyncResult[];
	inserted: number;
	skipped: number;
	syncedAt: number;
}

/** Rows fetched in a single sync before we stop and let the next run continue.
 *  Bounds worst-case time on a first sync against a huge, slow server; the
 *  watermark means the next run resumes exactly where this one stopped. */
const MAX_ROWS_PER_SYNC = 50_000;

/**
 * Earliest timestamp we'll believe: 2008-01-01.
 *
 * Plex Media Server didn't exist before then, so anything older is a broken
 * clock rather than history.
 */
const MIN_PLAUSIBLE_VIEWED_AT = 1_199_145_600;

/** Tolerance for a client running slightly fast. Beyond a day ahead, the
 *  timestamp is wrong rather than merely skewed. */
const FUTURE_TOLERANCE_SECONDS = 86_400;

/**
 * Whether a `viewedAt` can be a real viewing time.
 *
 * Plex records the timestamp the *client* reports, so a device with a bad clock
 * writes it straight into the server's history — a phone that had lost its RTC
 * produced entries dated 1954 on the test account. Such a row can't be placed
 * on a calendar at all, and a single one stretches the heatmap across decades,
 * so it's rejected at the door rather than stored and worked around everywhere
 * downstream.
 */
export function isPlausibleViewedAt(
	viewedAt: number,
	now = Math.floor(Date.now() / 1000)
): boolean {
	return viewedAt >= MIN_PLAUSIBLE_VIEWED_AT && viewedAt <= now + FUTURE_TOLERANCE_SECONDS;
}

/**
 * A stable identity for a history entry.
 *
 * Plex normally supplies `historyKey` (e.g. `/status/sessions/history/12345`),
 * which is unique per server. Some server versions omit it, so we fall back to
 * ratingKey+viewedAt — the same pair Plex itself treats as one view. Both forms
 * are deterministic, which is what makes re-syncing an overlapping window a
 * no-op rather than a duplicate.
 */
function entryKey(entry: PlexHistoryEntry): string | null {
	if (entry.historyKey) return entry.historyKey;
	if (entry.ratingKey && entry.viewedAt) return `synthetic:${entry.ratingKey}:${entry.viewedAt}`;
	return null;
}

function toRow(
	entry: PlexHistoryEntry,
	serverId: string,
	accountId: number,
	syncedAt: number
): NewHistoryRow | null {
	const key = entryKey(entry);
	// Without a viewedAt the entry can't be placed on the calendar, which is the
	// entire point of storing it.
	if (!key || !entry.viewedAt) return null;

	return {
		serverId,
		historyKey: key,
		accountId,
		serverAccountId: entry.accountID ?? null,
		ratingKey: entry.ratingKey ?? null,
		librarySectionId: entry.librarySectionID != null ? String(entry.librarySectionID) : null,
		type: entry.type ?? 'other',
		title: entry.title ?? 'Unknown',
		parentTitle: entry.parentTitle ?? null,
		grandparentTitle: entry.grandparentTitle ?? null,
		index: entry.index ?? null,
		parentIndex: entry.parentIndex ?? null,
		year: entry.year ?? null,
		thumb: entry.thumb ?? null,
		grandparentThumb: entry.grandparentThumb ?? entry.parentThumb ?? null,
		duration: entry.duration ?? null,
		originallyAvailableAt: entry.originallyAvailableAt ?? null,
		viewedAt: entry.viewedAt,
		deviceId: entry.deviceID ?? null,
		syncedAt
	};
}

/**
 * Stores the server's user roster so the activity views can name people.
 *
 * The signed-in account is always recorded even when the roster is empty — a
 * shared server won't enumerate its users, but you're demonstrably one of them,
 * and the picker needs at least that row to have something to select.
 */
async function recordServerAccounts(
	serverId: string,
	roster: PlexServerAccount[],
	selfId: number | null,
	account: Account
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);

	const rows = roster
		.filter((entry) => typeof entry.id === 'number')
		.map((entry) => ({
			serverId,
			accountId: entry.id,
			name: entry.name ?? null,
			thumb: entry.thumb ?? null,
			isSelf: selfId != null && entry.id === selfId,
			updatedAt: now
		}));

	if (selfId != null && !rows.some((row) => row.accountId === selfId)) {
		rows.push({
			serverId,
			accountId: selfId,
			name: account.username,
			thumb: account.thumb,
			isSelf: true,
			updatedAt: now
		});
	}

	if (rows.length === 0) return;

	await db
		.insert(serverAccounts)
		.values(rows)
		.onConflictDoUpdate({
			target: [serverAccounts.serverId, serverAccounts.accountId],
			set: {
				name: sql`excluded.name`,
				thumb: sql`excluded.thumb`,
				isSelf: sql`excluded.is_self`,
				updatedAt: sql`excluded.updated_at`
			}
		});
}

/** Refreshes each user's row count so the picker can hide accounts that exist
 *  but have never watched anything. */
async function refreshHistoryCounts(serverId: string): Promise<void> {
	await db.run(sql`
		UPDATE ${serverAccounts}
		SET ${sql.raw('history_count')} = COALESCE((
			SELECT COUNT(*) FROM ${history}
			WHERE ${history.serverId} = ${serverAccounts.serverId}
			  AND ${history.serverAccountId} = ${serverAccounts.accountId}
		), 0)
		WHERE ${serverAccounts.serverId} = ${serverId}
	`);
}

async function newestViewedAt(serverId: string, accountId: number): Promise<number> {
	const [row] = await db
		.select({ viewedAt: history.viewedAt })
		.from(history)
		.where(and(eq(history.serverId, serverId), eq(history.accountId, accountId)))
		.orderBy(desc(history.viewedAt))
		.limit(1);
	return row?.viewedAt ?? 0;
}

async function syncServer(
	server: Server,
	account: Account,
	clientId: string,
	full: boolean
): Promise<ServerSyncResult> {
	const result: ServerSyncResult = {
		serverId: server.clientIdentifier,
		serverName: server.name,
		inserted: 0,
		scanned: 0,
		skipped: 0,
		error: null
	};

	const target: ServerTarget = {
		clientId,
		accessToken: server.accessToken,
		// The last known-good address is tried first, then the rest. Re-probing
		// every candidate on every sync would add seconds per server.
		connections: [server.baseUrl, ...(server.connections?.split('\n') ?? [])].filter(
			(uri, index, all): uri is string => Boolean(uri) && all.indexOf(uri) === index
		)
	};

	try {
		const baseUrl = await resolveBaseUrl(target);

		// `/accounts` is admin-only, so this succeeds on servers you own and 403s
		// on ones merely shared with you. Both are fine: a shared server can only
		// ever show you your own history anyway.
		let roster: PlexServerAccount[] = [];
		try {
			roster = await getServerAccounts(baseUrl, target);
		} catch (error) {
			if (server.owned) throw error;
		}

		const serverAccountId =
			server.serverAccountId ?? matchServerAccount(roster, account.id, account.username);

		await recordServerAccounts(server.clientIdentifier, roster, serverAccountId, account);

		/*
		 * On a server you own, pull every user's history rather than just your own.
		 *
		 * The activity views default to you, so this changes nothing on screen
		 * until a user is picked — but the data has to already be there for the
		 * picker to have anything to offer, and back-filling someone else's history
		 * later would mean a second full walk.
		 */
		const accountFilter = server.owned ? null : serverAccountId;

		// Re-fetch the last hour on incremental runs. `viewedAt>` is exclusive and
		// a view can land in the same second as the watermark, so an exact
		// boundary can drop entries; the upsert makes the overlap free.
		const watermark = full
			? 0
			: Math.max(0, (await newestViewedAt(server.clientIdentifier, account.id)) - 3600);
		const syncedAt = Math.floor(Date.now() / 1000);

		let start = 0;
		let total = Infinity;

		while (start < total && result.scanned < MAX_ROWS_PER_SYNC) {
			const page = await fetchHistoryPage(baseUrl, target, {
				serverAccountId: accountFilter,
				viewedAfter: watermark > 0 ? watermark : undefined,
				start,
				size: HISTORY_PAGE_SIZE
			});

			total = page.totalSize;
			result.scanned += page.entries.length;

			const rows: NewHistoryRow[] = [];
			for (const entry of page.entries) {
				const row = toRow(entry, server.clientIdentifier, account.id, syncedAt);
				if (!row) continue;
				if (!isPlausibleViewedAt(row.viewedAt, syncedAt)) {
					result.skipped++;
					continue;
				}
				rows.push(row);
			}

			if (rows.length > 0) {
				// Chunked because SQLite caps variables per statement and each row
				// carries ~20 of them.
				for (let offset = 0; offset < rows.length; offset += 200) {
					const chunk = rows.slice(offset, offset + 200);
					const written = await db
						.insert(history)
						.values(chunk)
						.onConflictDoUpdate({
							target: [history.serverId, history.historyKey],
							// Refresh the denormalised fields but never viewedAt — a
							// re-sync should correct a title, not move a view in time.
							set: {
								title: sql`excluded.title`,
								parentTitle: sql`excluded.parent_title`,
								grandparentTitle: sql`excluded.grandparent_title`,
								thumb: sql`excluded.thumb`,
								grandparentThumb: sql`excluded.grandparent_thumb`,
								duration: sql`excluded.duration`,
								syncedAt: sql`excluded.synced_at`
							}
						})
						.returning({ historyKey: history.historyKey });
					result.inserted += written.length;
				}
			}

			// A short page means we've reached the end regardless of what the
			// container claimed the total was.
			if (page.entries.length < HISTORY_PAGE_SIZE) break;
			start += HISTORY_PAGE_SIZE;
		}

		// Self-heal: drop anything stored before this rule existed, or admitted
		// under an earlier one. Without it a bad row synced yesterday would sit in
		// the calendar forever, since an incremental sync never revisits it.
		await refreshHistoryCounts(server.clientIdentifier);

		const purged = await db
			.delete(history)
			.where(
				and(
					eq(history.serverId, server.clientIdentifier),
					eq(history.accountId, account.id),
					sql`(${history.viewedAt} < ${MIN_PLAUSIBLE_VIEWED_AT} OR ${history.viewedAt} > ${syncedAt + FUTURE_TOLERANCE_SECONDS})`
				)
			)
			.returning({ historyKey: history.historyKey });
		result.skipped += purged.length;

		await db
			.update(servers)
			.set({
				baseUrl,
				serverAccountId,
				lastSyncedAt: syncedAt,
				lastSyncError: null,
				updatedAt: syncedAt
			})
			.where(eq(servers.clientIdentifier, server.clientIdentifier));
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
		const now = Math.floor(Date.now() / 1000);
		await db
			.update(servers)
			.set({ lastSyncError: result.error, updatedAt: now })
			.where(eq(servers.clientIdentifier, server.clientIdentifier));
	}

	return result;
}

/**
 * Syncs every known server for an account.
 *
 * Servers are synced sequentially rather than in parallel: they're often the
 * same physical box behind different addresses, and a first sync is already a
 * heavy read for it. One unreachable server records its error and does not
 * prevent the others from syncing.
 */
export async function syncHistory(
	account: Account,
	clientId: string,
	{ full = false }: { full?: boolean } = {}
): Promise<SyncResult> {
	const targets = await db.select().from(servers).where(eq(servers.accountId, account.id));

	const results: ServerSyncResult[] = [];
	for (const server of targets) {
		results.push(await syncServer(server, account, clientId, full));
	}

	return {
		servers: results,
		inserted: results.reduce((sum, r) => sum + r.inserted, 0),
		skipped: results.reduce((sum, r) => sum + r.skipped, 0),
		syncedAt: Math.floor(Date.now() / 1000)
	};
}
