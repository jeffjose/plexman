/**
 * Read model for the Missing page: canonical episode lists minus what the
 * servers actually hold.
 *
 * The diff happens in JS rather than in SQL, which is not the obvious choice.
 * The obvious choice — a `NOT EXISTS` against `library_items` keyed on show
 * title and (season, episode) — has no index to stand on (episodes are linked
 * to their show by title, and there is no index on the title) and measured at
 * 47 seconds against a real 28,000-episode library. Reading both sides once and
 * intersecting them in a Set is two indexed scans and ~250ms.
 *
 * Day comparisons use the account's own zone for the same reason the rest of
 * the app does: "aired today" is a local statement, and an episode that dropped
 * this evening must not be reported as an overdue download.
 */

import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { canonicalEpisodes, libraryItems, librarySections, servers, shows } from '../db/schema';
import { addDays, todayKey } from '$lib/activity/dates';

/** Canonical rows read per request. Comfortably above a complete library's
 *  episode count; the cap exists so a runaway table can't stall a page load. */
const MAX_CANONICAL_ROWS = 40_000;

/** Announced episodes listed under "coming soon". Long-running shows publish
 *  a whole season's schedule at once, and thirty rows of dates nobody is
 *  waiting on yet isn't a useful page. */
const MAX_UPCOMING = 40;

export const MISSING_WINDOWS = [60, 365, null] as const;
export type MissingWindow = (typeof MISSING_WINDOWS)[number];

export interface MissingEpisode {
	id: string;
	serverId: string;
	showRatingKey: string;
	showTitle: string;
	year: number | null;
	thumb: string | null;
	season: number;
	episode: number;
	title: string | null;
	/** `YYYY-MM-DD`. Never null — an episode with no announced date is reported
	 *  as unknown, not as missing. */
	airDate: string;
}

export interface ShowGap {
	id: string;
	serverId: string;
	showTitle: string;
	thumb: string | null;
	count: number;
	/** The most recent air date among this show's gaps — what the rollup sorts
	 *  on, so the show you're mid-way through leads. */
	newestAirDate: string;
}

/**
 * What the check has and hasn't got to.
 *
 * Every number here is a fact about the queue, not an estimate: `pending` is
 * shows with a Plex identity that have never been checked, `unidentified` is
 * shows Plex's own agent never matched (a scanned folder, a YouTube channel)
 * and which by definition can't be checked at all.
 */
export interface MissingCoverage {
	total: number;
	identified: number;
	checked: number;
	pending: number;
	unidentified: number;
	failed: number;
	oldestCheckedAt: number | null;
	newestCheckedAt: number | null;
}

export interface MissingReport {
	recent: MissingEpisode[];
	/** Aired and missing, but older than the window — the noise being kept out
	 *  of the default view, counted rather than hidden. */
	older: number;
	/** Episodes announced without an air date. Unknown, not missing. */
	unknownAirDate: number;
	upcoming: MissingEpisode[];
	byShow: ShowGap[];
	coverage: MissingCoverage;
	windowDays: number | null;
	heldSeasonsOnly: boolean;
	truncated: boolean;
}

export interface MissingOptions {
	serverIds?: string[];
	/** Null means "everything that ever aired". */
	windowDays?: number | null;
	/**
	 * Restrict gaps to seasons the server holds at least one episode of.
	 *
	 * On by default, and the single biggest source of false positives when off:
	 * someone who keeps only the current season of a long-running show is not
	 * "missing" the other nine, they threw them away on purpose.
	 */
	heldSeasonsOnly?: boolean;
}

/** Shows on this account's servers, in unmuted libraries, within the nav scope.
 *  A muted library drops out here for the same reason it drops out of the
 *  additions view — you've said you don't want to hear about it. */
function showScope(accountId: number, serverIds: string[]): SQL | undefined {
	return and(
		sql`${shows.serverId} IN (SELECT ${servers.clientIdentifier} FROM ${servers} WHERE ${servers.accountId} = ${accountId})`,
		sql`${shows.serverId} || ':' || ${shows.sectionKey} NOT IN (
			SELECT ${librarySections.serverId} || ':' || ${librarySections.sectionKey}
			FROM ${librarySections} WHERE ${librarySections.hidden} = 1
		)`,
		serverIds.length ? inArray(shows.serverId, serverIds) : undefined
	);
}

interface Held {
	pairs: Set<string>;
	seasons: Set<number>;
}

/**
 * Every episode the servers hold, keyed by the show it belongs to.
 *
 * Keyed on `server:section:title` because `library_items` carries no
 * grandparent rating key — the show title within its library is the only link
 * back to a show row. Two shows with the same title in one library therefore
 * pool their episodes, which can only ever hide a gap, never invent one.
 */
async function heldByShow(serverIds: string[]): Promise<Map<string, Held>> {
	const rows = await db
		.select({
			serverId: libraryItems.serverId,
			sectionKey: libraryItems.sectionKey,
			title: libraryItems.grandparentTitle,
			season: libraryItems.parentIndex,
			episode: libraryItems.index
		})
		.from(libraryItems)
		.where(
			and(
				eq(libraryItems.type, 'episode'),
				isNotNull(libraryItems.grandparentTitle),
				serverIds.length ? inArray(libraryItems.serverId, serverIds) : undefined
			)
		);

	const held = new Map<string, Held>();
	for (const row of rows) {
		if (row.season == null || row.episode == null || !row.title) continue;
		const key = `${row.serverId}:${row.sectionKey}:${row.title}`;
		let entry = held.get(key);
		if (!entry) held.set(key, (entry = { pairs: new Set(), seasons: new Set() }));
		entry.pairs.add(`${row.season}:${row.episode}`);
		entry.seasons.add(row.season);
	}
	return held;
}

async function getCoverage(accountId: number, serverIds: string[]): Promise<MissingCoverage> {
	const [row] = await db
		.select({
			total: sql<number>`count(*)`,
			identified: sql<number>`sum(case when ${shows.guid} like 'plex://show/%' then 1 else 0 end)`,
			checked: sql<number>`sum(case when ${shows.checkedAt} is not null then 1 else 0 end)`,
			failed: sql<number>`sum(case when ${shows.checkError} is not null then 1 else 0 end)`,
			oldestCheckedAt: sql<number | null>`min(${shows.checkedAt})`,
			newestCheckedAt: sql<number | null>`max(${shows.checkedAt})`
		})
		.from(shows)
		.where(showScope(accountId, serverIds));

	const total = Number(row?.total ?? 0);
	const identified = Number(row?.identified ?? 0);
	const checked = Number(row?.checked ?? 0);

	return {
		total,
		identified,
		checked,
		pending: Math.max(0, identified - checked),
		unidentified: total - identified,
		failed: Number(row?.failed ?? 0),
		oldestCheckedAt: row?.oldestCheckedAt ?? null,
		newestCheckedAt: row?.newestCheckedAt ?? null
	};
}

export async function getMissingReport(
	accountId: number,
	timeZone: string,
	{ serverIds = [], windowDays = 60, heldSeasonsOnly = true }: MissingOptions = {}
): Promise<MissingReport> {
	const scope = showScope(accountId, serverIds);

	const [candidates, held, coverage, [unknown]] = await Promise.all([
		db
			.select({
				serverId: shows.serverId,
				showRatingKey: shows.ratingKey,
				sectionKey: shows.sectionKey,
				showTitle: shows.title,
				year: shows.year,
				thumb: shows.thumb,
				season: canonicalEpisodes.season,
				episode: canonicalEpisodes.episode,
				title: canonicalEpisodes.title,
				airDate: canonicalEpisodes.airDate
			})
			.from(shows)
			.innerJoin(canonicalEpisodes, eq(canonicalEpisodes.showGuid, shows.guid))
			.where(and(scope, gt(canonicalEpisodes.season, 0), isNotNull(canonicalEpisodes.airDate)))
			.orderBy(desc(canonicalEpisodes.airDate), asc(shows.title))
			.limit(MAX_CANONICAL_ROWS + 1),
		heldByShow(serverIds),
		getCoverage(accountId, serverIds),
		db
			.select({ n: sql<number>`count(*)` })
			.from(shows)
			.innerJoin(canonicalEpisodes, eq(canonicalEpisodes.showGuid, shows.guid))
			.where(and(scope, gt(canonicalEpisodes.season, 0), isNull(canonicalEpisodes.airDate)))
	]);

	const truncated = candidates.length > MAX_CANONICAL_ROWS;
	const rows = truncated ? candidates.slice(0, MAX_CANONICAL_ROWS) : candidates;

	const today = todayKey(timeZone);
	const windowStart = windowDays === null ? null : addDays(today, -windowDays);

	const recent: MissingEpisode[] = [];
	const upcoming: MissingEpisode[] = [];
	const gaps = new Map<string, ShowGap>();
	let older = 0;

	for (const row of rows) {
		const airDate = row.airDate!;
		const owner = held.get(`${row.serverId}:${row.sectionKey}:${row.showTitle}`);

		// A show with no episodes at all isn't one you're missing episodes of —
		// it's one you haven't started. Reporting it would bury the real gaps.
		if (!owner) continue;
		if (owner.pairs.has(`${row.season}:${row.episode}`)) continue;

		const item: MissingEpisode = {
			id: `${row.serverId}:${row.showRatingKey}:${row.season}:${row.episode}`,
			serverId: row.serverId,
			showRatingKey: row.showRatingKey,
			showTitle: row.showTitle,
			year: row.year,
			thumb: row.thumb,
			season: row.season,
			episode: row.episode,
			title: row.title,
			airDate
		};

		if (airDate > today) {
			// Deliberately not filtered by held seasons: a new season you own none of
			// yet is exactly the thing "coming soon" is for. Capped after sorting
			// below, not here — rows arrive newest-first, so trimming at this point
			// would keep the furthest-out episodes and drop next week's.
			upcoming.push(item);
			continue;
		}

		if (heldSeasonsOnly && !owner.seasons.has(row.season)) continue;

		if (windowStart !== null && airDate < windowStart) {
			older++;
			continue;
		}

		recent.push(item);

		const key = `${row.serverId}:${row.showRatingKey}`;
		const gap = gaps.get(key);
		if (gap) {
			gap.count++;
		} else {
			gaps.set(key, {
				id: key,
				serverId: row.serverId,
				showTitle: row.showTitle,
				thumb: row.thumb,
				count: 1,
				// Rows arrive newest-first, so the first gap seen for a show is also
				// its most recent one.
				newestAirDate: airDate
			});
		}
	}

	upcoming.sort((a, b) => a.airDate.localeCompare(b.airDate));

	return {
		recent,
		older,
		unknownAirDate: Number(unknown?.n ?? 0),
		upcoming: upcoming.slice(0, MAX_UPCOMING),
		byShow: [...gaps.values()].sort(
			(a, b) => b.count - a.count || b.newestAirDate.localeCompare(a.newestAirDate)
		),
		coverage,
		windowDays,
		heldSeasonsOnly,
		truncated
	};
}
