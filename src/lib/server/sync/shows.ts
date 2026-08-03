/**
 * Keeps the shows table current, and refreshes canonical episode lists for the
 * shows worth spending requests on.
 *
 * Two halves with very different costs. The first is one call per show library
 * and is essentially free. The second walks `metadata.provider.plex.tv` — a
 * seasons call plus one call per season, so roughly 3–4 requests per show. At
 * 568 shows that is ~2,000 requests, which is not something to do on every
 * sync, so the second half is a *queue*: shows are ranked by how likely they
 * are to have changed, a bounded number are checked, and the rest wait. What
 * was skipped is recoverable from `checkedAt` rather than being thrown away —
 * the Missing page reports coverage from it.
 */

import { and, eq, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '../db';
import {
	canonicalEpisodes,
	libraryItems,
	librarySections,
	servers,
	shows,
	type Account,
	type NewCanonicalEpisode,
	type NewShow,
	type Server
} from '../db/schema';
import { getLibrarySections } from '../plex/library';
import { resolveBaseUrl, type ServerTarget } from '../plex/server';
import {
	externalIdsOf,
	fetchCanonicalEpisodes,
	fetchCanonicalSeasons,
	fetchShows,
	plexGuidId,
	type MetadataTarget
} from '../plex/shows';

export interface ShowSyncResult {
	checked: number;
	missing: number;
	errors: string[];
}

const DAY = 86_400;

/**
 * Shows whose canonical list gets refreshed in one sync.
 *
 * ~3.3 requests each, measured across 30 real shows, so 50 is about 165
 * requests and 40 seconds — long enough to be worth bounding, short enough that
 * a sync still finishes. `full` widens it rather than removing it: an unbounded
 * run against a large library is a twenty-minute request nobody asked for.
 */
const MAX_CHECKS_PER_SYNC = 50;
const MAX_CHECKS_PER_FULL_SYNC = 200;

/** Between metadata-service calls. plex.tv is somebody else's infrastructure and
 *  this is a background job; there is no reason to hammer it. */
const METADATA_DELAY_MS = 100;

/**
 * How long a show's canonical list stays fresh, by how recently it was fed.
 *
 * A show that received an episode in the last few weeks is airing, and airing
 * shows are the only ones whose episode list changes — those are worth a daily
 * look. A show last touched years ago is finished; its list will be the same
 * next month as it is today, and re-reading it is pure cost.
 */
function checkTtl(lastEpisodeAddedAt: number | null, now: number): number {
	const age = now - (lastEpisodeAddedAt ?? 0);
	if (age <= 45 * DAY) return DAY;
	if (age <= 365 * DAY) return 10 * DAY;
	return 45 * DAY;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function targetFor(server: Server, clientId: string): ServerTarget {
	return {
		clientId,
		accessToken: server.accessToken,
		connections: [server.baseUrl, ...(server.connections?.split('\n') ?? [])].filter(
			(uri, index, all): uri is string => Boolean(uri) && all.indexOf(uri) === index
		)
	};
}

/**
 * Newest episode `addedAt` per show title, for one section.
 *
 * Episodes are linked to their show by title because `library_items` stores no
 * grandparent rating key — see the note on `heldEpisodes` below. Aggregating
 * here in one query beats a correlated subquery per show row.
 */
async function lastEpisodeAddedAtBySection(
	serverId: string,
	sectionKey: string
): Promise<Map<string, number>> {
	const rows = await db
		.select({
			title: libraryItems.grandparentTitle,
			addedAt: sql<number>`max(${libraryItems.addedAt})`
		})
		.from(libraryItems)
		.where(
			and(
				eq(libraryItems.serverId, serverId),
				eq(libraryItems.sectionKey, sectionKey),
				eq(libraryItems.type, 'episode'),
				isNotNull(libraryItems.grandparentTitle)
			)
		)
		.groupBy(libraryItems.grandparentTitle);

	return new Map(rows.filter((row) => row.title).map((row) => [row.title!, Number(row.addedAt)]));
}

/**
 * The (season, episode) pairs a server holds for a show.
 *
 * Matched on `grandparentTitle` within the section, because `library_items` has
 * no grandparent rating key to join on. Two shows sharing a title in one
 * library therefore see each other's episodes — which under-reports gaps rather
 * than inventing them, the right way round for a tool whose failure mode is
 * crying wolf.
 */
async function heldEpisodes(serverId: string, sectionKey: string, title: string) {
	const rows = await db
		.select({ season: libraryItems.parentIndex, episode: libraryItems.index })
		.from(libraryItems)
		.where(
			and(
				eq(libraryItems.serverId, serverId),
				eq(libraryItems.sectionKey, sectionKey),
				eq(libraryItems.type, 'episode'),
				eq(libraryItems.grandparentTitle, title)
			)
		);

	const pairs = new Set<string>();
	const seasons = new Set<number>();
	for (const row of rows) {
		if (row.season == null || row.episode == null) continue;
		pairs.add(`${row.season}:${row.episode}`);
		seasons.add(row.season);
	}
	return { pairs, seasons };
}

/**
 * Pulls every show in every (unmuted) show library into the shows table.
 *
 * Muted libraries are skipped for the same reason they drop out of the
 * additions view: a library you've told the app to ignore shouldn't start
 * generating "you're missing 400 episodes" for a YouTube channel.
 */
async function syncShowRows(
	baseUrl: string,
	target: ServerTarget,
	serverId: string,
	errors: string[]
): Promise<void> {
	const sections = (await getLibrarySections(baseUrl, target)).filter(
		(section) => section.type === 'show'
	);

	const muted = new Set(
		(
			await db
				.select({ sectionKey: librarySections.sectionKey })
				.from(librarySections)
				.where(and(eq(librarySections.serverId, serverId), eq(librarySections.hidden, true)))
		).map((row) => row.sectionKey)
	);

	for (const section of sections) {
		const sectionKey = String(section.key);
		if (muted.has(sectionKey)) continue;

		const syncedAt = Math.floor(Date.now() / 1000);

		try {
			const entries = await fetchShows(baseUrl, target, sectionKey);
			const lastEpisode = await lastEpisodeAddedAtBySection(serverId, sectionKey);

			const rows: NewShow[] = [];
			for (const entry of entries) {
				if (!entry.ratingKey || !entry.title) continue;
				rows.push({
					serverId,
					ratingKey: entry.ratingKey,
					sectionKey,
					guid: entry.guid ?? null,
					externalIds: externalIdsOf(entry),
					title: entry.title,
					year: entry.year ?? null,
					thumb: entry.thumb ?? null,
					leafCount: entry.leafCount ?? null,
					childCount: entry.childCount ?? null,
					addedAt: entry.addedAt ?? null,
					lastEpisodeAddedAt: lastEpisode.get(entry.title) ?? null,
					syncedAt
				});
			}

			for (let offset = 0; offset < rows.length; offset += 200) {
				await db
					.insert(shows)
					.values(rows.slice(offset, offset + 200))
					.onConflictDoUpdate({
						target: [shows.serverId, shows.ratingKey],
						// Everything the server is authoritative about follows the source.
						// `checkedAt` and `checkError` are deliberately absent: they belong
						// to the metadata half and must survive a cheap show refresh, or
						// every sync would reset the queue to "nothing checked".
						set: {
							sectionKey: sql`excluded.section_key`,
							guid: sql`excluded.guid`,
							externalIds: sql`excluded.external_ids`,
							title: sql`excluded.title`,
							year: sql`excluded.year`,
							thumb: sql`excluded.thumb`,
							leafCount: sql`excluded.leaf_count`,
							childCount: sql`excluded.child_count`,
							addedAt: sql`excluded.added_at`,
							lastEpisodeAddedAt: sql`excluded.last_episode_added_at`,
							syncedAt: sql`excluded.synced_at`
						}
					});
			}

			// Shows deleted from the library keep their row otherwise, and a deleted
			// show reads as one you're missing every episode of. Anything not
			// re-stamped by the upsert above is gone from Plex.
			await db
				.delete(shows)
				.where(
					and(
						eq(shows.serverId, serverId),
						eq(shows.sectionKey, sectionKey),
						lt(shows.syncedAt, syncedAt)
					)
				);
		} catch (error) {
			errors.push(`${section.title}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

interface Candidate {
	serverId: string;
	ratingKey: string;
	sectionKey: string;
	title: string;
	guid: string;
	guidId: string;
	lastEpisodeAddedAt: number | null;
	checkedAt: number | null;
}

/**
 * The shows most worth spending requests on, best first.
 *
 * Ordered by tier before staleness: an airing show that was checked yesterday
 * still matters more than a finished one that has never been checked, because
 * only the former can have gained an episode since. Within a tier, never-checked
 * shows lead and then the oldest check — so a first run spends its whole budget
 * on what's currently airing and later runs drain the back catalogue.
 */
function rank(candidates: Candidate[], now: number, full: boolean): Candidate[] {
	const tier = (candidate: Candidate) => {
		const age = now - (candidate.lastEpisodeAddedAt ?? 0);
		if (age <= 45 * DAY) return 0;
		if (age <= 365 * DAY) return 1;
		return 2;
	};

	return candidates
		.filter(
			(candidate) =>
				full ||
				candidate.checkedAt === null ||
				now - candidate.checkedAt >= checkTtl(candidate.lastEpisodeAddedAt, now)
		)
		.sort(
			(a, b) =>
				tier(a) - tier(b) ||
				(a.checkedAt ?? 0) - (b.checkedAt ?? 0) ||
				(b.lastEpisodeAddedAt ?? 0) - (a.lastEpisodeAddedAt ?? 0)
		);
}

/**
 * Refreshes one show's canonical episode list and counts what's missing.
 *
 * The stored list is replaced wholesale, but only when every season came back
 * cleanly: a partial replacement would delete episodes we still believe in on
 * the strength of one failed request. A show whose walk failed keeps its old
 * list, records the error, and still gets a `checkedAt` so a permanently broken
 * show can't eat the budget on every sync.
 */
async function checkShow(candidate: Candidate, target: MetadataTarget, today: string) {
	const fetched: NewCanonicalEpisode[] = [];
	const fetchedAt = Math.floor(Date.now() / 1000);

	const seasons = await fetchCanonicalSeasons(candidate.guidId, target);
	for (const season of seasons) {
		await sleep(METADATA_DELAY_MS);
		for (const episode of await fetchCanonicalEpisodes(season, target)) {
			fetched.push({
				showGuid: candidate.guid,
				season: episode.season,
				episode: episode.episode,
				title: episode.title,
				airDate: episode.airDate,
				fetchedAt
			});
		}
	}

	await db.delete(canonicalEpisodes).where(eq(canonicalEpisodes.showGuid, candidate.guid));
	for (let offset = 0; offset < fetched.length; offset += 200) {
		await db
			.insert(canonicalEpisodes)
			.values(fetched.slice(offset, offset + 200))
			// Plex has been seen listing the same index twice within a season; last
			// one wins rather than the whole batch failing.
			.onConflictDoUpdate({
				target: [canonicalEpisodes.showGuid, canonicalEpisodes.season, canonicalEpisodes.episode],
				set: {
					title: sql`excluded.title`,
					airDate: sql`excluded.air_date`,
					fetchedAt: sql`excluded.fetched_at`
				}
			});
	}

	const held = await heldEpisodes(candidate.serverId, candidate.sectionKey, candidate.title);
	return fetched.filter(
		(row) =>
			Boolean(row.airDate) &&
			row.airDate! <= today &&
			held.seasons.has(row.season) &&
			!held.pairs.has(`${row.season}:${row.episode}`)
	).length;
}

export async function syncShows(
	account: Account,
	clientId: string,
	{ full = false }: { full?: boolean } = {}
): Promise<ShowSyncResult> {
	const errors: string[] = [];
	let checked = 0;
	let missing = 0;

	// Owned servers only, matching the library sync: a friend's server is not
	// somewhere you can act on a missing episode.
	const targets: Server[] = await db
		.select()
		.from(servers)
		.where(and(eq(servers.accountId, account.id), eq(servers.owned, true)));

	const serverIds: string[] = [];

	for (const server of targets) {
		const target = targetFor(server, clientId);

		let baseUrl: string;
		try {
			baseUrl = await resolveBaseUrl(target);
		} catch (error) {
			errors.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}

		serverIds.push(server.clientIdentifier);
		await syncShowRows(baseUrl, target, server.clientIdentifier, errors);
	}

	if (!serverIds.length) return { checked, missing, errors };

	const now = Math.floor(Date.now() / 1000);

	// The tally below is bucketed in UTC rather than the account's zone: a sync
	// has no request to borrow a timezone from, and this number is a summary.
	// The Missing page recomputes it in local time, and is what you should
	// believe about an episode that aired today.
	const today = new Date(now * 1000).toISOString().slice(0, 10);

	const rows = await db
		.select({
			serverId: shows.serverId,
			ratingKey: shows.ratingKey,
			sectionKey: shows.sectionKey,
			title: shows.title,
			guid: shows.guid,
			lastEpisodeAddedAt: shows.lastEpisodeAddedAt,
			checkedAt: shows.checkedAt
		})
		.from(shows)
		.where(
			and(
				inArray(shows.serverId, serverIds),
				// Rows from a library that has since been muted stay in the table —
				// unmuting it shouldn't cost you its check history — but they must not
				// take budget from libraries you actually want watched.
				sql`${shows.serverId} || ':' || ${shows.sectionKey} NOT IN (
					SELECT ${librarySections.serverId} || ':' || ${librarySections.sectionKey}
					FROM ${librarySections} WHERE ${librarySections.hidden} = 1
				)`
			)
		);

	const candidates: Candidate[] = rows.flatMap((row) => {
		const guidId = plexGuidId(row.guid, 'show');
		// No `plex://show/…` guid means Plex's own agent never matched it — a
		// locally-scanned folder or a YouTube channel. There is nothing to compare
		// it against, so it costs nothing and is simply never queued.
		if (!row.guid || !guidId) return [];
		return [{ ...row, guid: row.guid, guidId }];
	});

	const queue = rank(candidates, now, full);
	const budget = full ? MAX_CHECKS_PER_FULL_SYNC : MAX_CHECKS_PER_SYNC;
	const metadata: MetadataTarget = { clientId, authToken: account.authToken };

	for (const candidate of queue.slice(0, budget)) {
		let checkError: string | null = null;
		try {
			missing += await checkShow(candidate, metadata, today);
		} catch (error) {
			checkError = error instanceof Error ? error.message : String(error);
			errors.push(`${candidate.title}: ${checkError}`);
		}

		await db
			.update(shows)
			.set({ checkedAt: Math.floor(Date.now() / 1000), checkError })
			.where(and(eq(shows.serverId, candidate.serverId), eq(shows.ratingKey, candidate.ratingKey)));

		checked++;
		await sleep(METADATA_DELAY_MS);
	}

	if (queue.length > budget) {
		console.info(
			`[plexman] ${queue.length - budget} shows past their refresh window were deferred to the next sync`
		);
	}

	// Canonical lists outlive the show rows that referenced them — they're keyed
	// on a Plex guid so two servers can share one list — so a full run is where
	// lists for shows nobody holds any more get collected.
	if (full) {
		// A subquery rather than a correlated `not exists`: SQLite materialises the
		// guid list once and probes it, where the correlated form re-scans the
		// whole shows table for every canonical row.
		await db
			.delete(canonicalEpisodes)
			.where(
				notInArray(
					canonicalEpisodes.showGuid,
					db.select({ guid: shows.guid }).from(shows).where(isNotNull(shows.guid))
				)
			);
	}

	return { checked, missing, errors };
}
