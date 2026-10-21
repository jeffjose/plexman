/**
 * The cheap sync — what runs on a timer, as opposed to what runs when you press
 * the button.
 *
 * The full sync (`/api/sync`) is not slow because walking a delta is expensive;
 * measured against a real server the incremental library pages come back in
 * 8–39ms and usually contain nothing. It's slow because it pays a fixed toll
 * every time regardless of whether anything changed: a plex.tv resources call
 * (~400ms), a roster fetch, a correlated UPDATE rebuilding per-user history
 * counts over the whole table, an implausible-timestamp purge, and up to 50
 * plex.tv show-metadata lookups (~10-25s). None of that is wrong; it's just
 * maintenance, and maintenance doesn't belong on a 90-second timer.
 *
 * So this does the opposite: nothing that isn't provably necessary.
 *
 *   - Servers come from the database. Addresses and tokens change rarely, and
 *     a stale one surfaces as an error the full sync then repairs.
 *   - History asks Plex the same filtered question the full sync does, which is
 *     one request returning zero rows when nothing was watched.
 *   - Libraries are gated on Plex's own change counter, so the common case is a
 *     single `/library/sections` call that decides to do nothing at all.
 *   - Shows are not touched. Nothing about a show's episode list changes on a
 *     timescale a poll can see.
 *
 * What it deliberately will not do is a *first* walk. A section or server with
 * no prior sync is left to the full sync and reported as pending — otherwise
 * opening the app for the first time would silently kick off a 52,000-item
 * crawl from a background timer nobody asked to start.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { history, librarySections, servers, type Account, type Server } from '../db/schema';
import { getSessions, resolveBaseUrl, targetFor } from '../plex/server';
import { getLibrarySections, isSupportedSection } from '../plex/library';
import type { PlexSession } from '../plex/types';
import { historyScopeFor, newestViewedAt, refreshHistoryCounts, walkHistory } from './history';
import { syncSection } from './library';

/** A play in progress, flattened to what a UI would show. Never stored — the
 *  durable record arrives later as a history row. */
export interface LiveSession {
	serverId: string;
	serverName: string;
	key: string;
	type: string;
	title: string;
	/** Show or artist, for episodes and tracks. */
	grandparentTitle: string | null;
	parentTitle: string | null;
	index: number | null;
	parentIndex: number | null;
	thumb: string | null;
	user: string | null;
	player: string | null;
	/** 'playing' | 'paused' | 'buffering', as Plex reports it. */
	state: string | null;
	/** 0–1, or null when Plex omits the duration. */
	progress: number | null;
	/** Milliseconds left, or null when the duration is unknown. Sent rather than
	 *  derived client-side because the offset is only true as of this poll. */
	remainingMs: number | null;
}

export interface LightServerResult {
	serverId: string;
	serverName: string;
	inserted: number;
	added: number;
	/** Sections skipped because they've never had a full walk. */
	pendingSections: string[];
	error: string | null;
}

export interface LightSyncResult {
	/** Whether any stored row actually moved. The caller uses this to decide
	 *  whether re-running every page load is worth it — on a quiet server this is
	 *  false almost every time, and that's the entire point. */
	changed: boolean;
	inserted: number;
	added: number;
	sessions: LiveSession[];
	servers: LightServerResult[];
	syncedAt: number;
	/** Wall-clock milliseconds, so a regression here is visible rather than felt. */
	ms: number;
}

/**
 * Rows a single light sync will pull before stopping.
 *
 * Far below the full sync's ceiling on purpose: if this many entries are new,
 * something happened that a poll isn't the right tool for (a history rewrite, a
 * server restored from backup) and the next run — or the button — continues
 * from the watermark regardless.
 */
const MAX_ROWS_PER_LIGHT_SYNC = 2_000;

/**
 * Has this section changed since we last walked it?
 *
 * `contentChangedAt` is a counter Plex bumps on any content change, so an equal
 * value is a genuine "nothing happened" and costs one request for the whole
 * server. Servers that don't report it fall back to `scannedAt`, which moves on
 * every scan whether or not it found anything — that over-reports change, which
 * is the harmless direction: a wasted delta page, never a missed item.
 */
function sectionChanged(
	live: { contentChangedAt?: number; scannedAt?: number },
	stored: { contentChangedAt: number | null; scannedAt: number | null }
): boolean {
	if (live.contentChangedAt != null && stored.contentChangedAt != null) {
		return live.contentChangedAt !== stored.contentChangedAt;
	}
	if (live.scannedAt != null && stored.scannedAt != null) {
		return live.scannedAt !== stored.scannedAt;
	}
	// One side can't say. Walking is cheap; missing an addition isn't.
	return true;
}

/** Rows stored for one server. An index-only scan over the primary key's
 *  leading column, so this stays cheap as history grows. */
async function historyCount(serverId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(history)
		.where(eq(history.serverId, serverId));
	return Number(row?.n ?? 0);
}

function toLiveSession(session: PlexSession, server: Server): LiveSession {
	const offset = session.viewOffset;
	const duration = session.duration;

	return {
		serverId: server.clientIdentifier,
		serverName: server.name,
		key: session.sessionKey ?? session.ratingKey ?? '',
		type: session.type ?? 'other',
		title: session.title ?? 'Unknown',
		grandparentTitle: session.grandparentTitle ?? null,
		parentTitle: session.parentTitle ?? null,
		index: session.index ?? null,
		parentIndex: session.parentIndex ?? null,
		thumb: session.grandparentThumb ?? session.parentThumb ?? session.thumb ?? null,
		user: session.User?.title ?? null,
		player: session.Player?.title ?? session.Player?.product ?? null,
		state: session.Player?.state ?? null,
		progress:
			offset != null && duration != null && duration > 0
				? Math.min(1, Math.max(0, offset / duration))
				: null,
		remainingMs: offset != null && duration != null && duration > offset ? duration - offset : null
	};
}

async function lightSyncServer(
	server: Server,
	account: Account,
	clientId: string
): Promise<{ result: LightServerResult; sessions: LiveSession[] }> {
	const result: LightServerResult = {
		serverId: server.clientIdentifier,
		serverName: server.name,
		inserted: 0,
		added: 0,
		pendingSections: [],
		error: null
	};
	const sessions: LiveSession[] = [];

	try {
		const target = targetFor(server, clientId);
		const baseUrl = await resolveBaseUrl(target);
		const syncedAt = Math.floor(Date.now() / 1000);

		/*
		 * Sessions first: it's the one thing here that can't be recovered later. A
		 * play that ends between two polls leaves a history row behind, but nothing
		 * records that it was on screen at 8pm.
		 *
		 * Best-effort, though. `/status/sessions` is admin-only and a server merely
		 * shared with you answers 403 — measured against a real one. Letting that
		 * throw would cost that server its history sync too, which is the part a
		 * shared server *can* answer, and would park a permanent error on a row
		 * that's working fine.
		 */
		try {
			for (const session of await getSessions(baseUrl, target)) {
				sessions.push(toLiveSession(session, server));
			}
		} catch (error) {
			if (server.owned) throw error;
		}

		/*
		 * History, but only where the watermark is trustworthy.
		 *
		 * A server that has never synced has no watermark, and one whose scope has
		 * widened has a watermark that no longer covers everyone it's about to
		 * describe. Both need a walk from zero, which is the full sync's job — a
		 * poll quietly starting one would be the heavyweight behaviour this exists
		 * to avoid.
		 */
		const { accountFilter, scope } = historyScopeFor(server, server.serverAccountId);
		const walkable = server.lastSyncedAt != null && server.historyScope === scope;

		if (walkable) {
			// The same one-hour overlap the full sync uses: `viewedAt>` is exclusive
			// and a view can land on the watermark second, so an exact boundary drops
			// entries. The upsert makes re-seeing them free.
			const watermark = Math.max(
				0,
				(await newestViewedAt(server.clientIdentifier, account.id)) - 3600
			);

			/*
			 * Count before and after, rather than trusting the walk's own tally.
			 *
			 * The upsert's `RETURNING` counts updated rows as well as inserted ones,
			 * and the overlap window re-touches everything watched in the last hour
			 * on every single run. Reported directly that would make `changed` true
			 * forever after any recent play, and the poll would re-run every query on
			 * the page every 90 seconds for no reason — measured doing exactly that.
			 * A row count only moves when a row is genuinely new.
			 */
			const before = await historyCount(server.clientIdentifier);

			await walkHistory(baseUrl, target, server.clientIdentifier, account.id, {
				accountFilter,
				watermark,
				syncedAt,
				maxRows: MAX_ROWS_PER_LIGHT_SYNC
			});

			result.inserted = (await historyCount(server.clientIdentifier)) - before;

			// Correlated over the whole history table, so it earns its keep only when
			// there's actually a new row to count.
			if (result.inserted > 0) await refreshHistoryCounts(server.clientIdentifier);
		}

		// Libraries are only readable in full on servers you own, matching the full
		// sync — a shared server answers 403 to half of this.
		if (server.owned) {
			const live = (await getLibrarySections(baseUrl, target)).filter(isSupportedSection);
			const stored = await db
				.select()
				.from(librarySections)
				.where(eq(librarySections.serverId, server.clientIdentifier));

			for (const section of live) {
				const key = String(section.key);
				const known = stored.find((row) => row.sectionKey === key);

				if (!known || known.lastSyncedAt == null) {
					result.pendingSections.push(section.title);
					continue;
				}
				if (!sectionChanged(section, known)) continue;

				const walked = await syncSection(
					baseUrl,
					target,
					server.clientIdentifier,
					{
						key,
						title: section.title,
						type: section.type,
						contentChangedAt: section.contentChangedAt,
						scannedAt: section.scannedAt
					},
					false
				);
				result.added += walked.added;
				if (walked.error) result.error = walked.error;
			}
		}

		// `lastSyncedAt` is deliberately left alone: it marks the last *full* sync,
		// which is what the show and deletion passes are scheduled against. A light
		// run moving it would make those look fresher than they are.
		await db
			.update(servers)
			.set({ lastSyncError: null, updatedAt: syncedAt })
			.where(eq(servers.clientIdentifier, server.clientIdentifier));
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
		await db
			.update(servers)
			.set({ lastSyncError: result.error, updatedAt: Math.floor(Date.now() / 1000) })
			.where(eq(servers.clientIdentifier, server.clientIdentifier));
	}

	return { result, sessions };
}

/**
 * In-flight light syncs, keyed by account.
 *
 * Two timers drive this — the browser's while a tab is open, the server's while
 * it isn't — and they will overlap. The writes are upserts so an overlap is
 * harmless, but it's pointless work against the same server, so the second
 * caller waits on the first one's answer instead of asking again.
 */
const inFlight = new Map<number, Promise<LightSyncResult>>();

export function lightSync(account: Account, clientId: string): Promise<LightSyncResult> {
	const running = inFlight.get(account.id);
	if (running) return running;

	const started = run(account, clientId).finally(() => inFlight.delete(account.id));
	inFlight.set(account.id, started);
	return started;
}

async function run(account: Account, clientId: string): Promise<LightSyncResult> {
	const startedAt = Date.now();

	const targets = await db.select().from(servers).where(eq(servers.accountId, account.id));

	const results: LightServerResult[] = [];
	const sessions: LiveSession[] = [];

	// Sequential, as in the full sync: several entries are often the same physical
	// box reached by different addresses.
	for (const server of targets) {
		const outcome = await lightSyncServer(server, account, clientId);
		results.push(outcome.result);
		sessions.push(...outcome.sessions);
	}

	const inserted = results.reduce((sum, r) => sum + r.inserted, 0);
	const added = results.reduce((sum, r) => sum + r.added, 0);

	return {
		changed: inserted > 0 || added > 0,
		inserted,
		added,
		sessions,
		servers: results,
		syncedAt: Math.floor(Date.now() / 1000),
		ms: Date.now() - startedAt
	};
}
