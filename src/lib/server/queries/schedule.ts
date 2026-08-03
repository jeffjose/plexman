/**
 * Read model for the Schedule page: every episode a show is known to have,
 * marked with whether the servers actually hold it.
 *
 * The diff happens in JS rather than in SQL, which is not the obvious choice.
 * The obvious choice — a `NOT EXISTS` against `library_items` keyed on show
 * title and (season, episode) — has no index to stand on (episodes link to
 * their show by title, and there is no index on the title) and measured at 47
 * seconds against a real 28,000-episode library. Reading both sides once and
 * intersecting them in a Set is two indexed scans and ~250ms.
 *
 * Day comparisons use the account's own zone for the same reason the rest of
 * the app does: "aired today" is a local statement, and an episode that dropped
 * this evening must not be reported as an overdue download.
 */

import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { canonicalEpisodes, libraryItems, librarySections, servers, shows } from '../db/schema';
import { daysBetween, todayKey } from '$lib/activity/dates';

/** Canonical rows read per request. Comfortably above a complete library's
 *  episode count; the cap exists so a runaway table can't stall a page load. */
const MAX_CANONICAL_ROWS = 40_000;

/**
 * How far ahead "upcoming" reaches, in days.
 *
 * Long-running shows publish a whole season's dates at once, so without a limit
 * the list fills with episodes months out that nothing can be done about. A week
 * covers the next instalment of anything on a weekly cadence, which is the only
 * thing worth being told about in advance.
 */
const UPCOMING_HORIZON_DAYS = 7;

export type EpisodeStatus = 'held' | 'missing' | 'upcoming';

/**
 * Why an episode is absent — the distinction that decides whether you should
 * care.
 *
 * `hole` means held episodes sit on *both* sides of it in the same season: the
 * download genuinely failed or the file was lost, because you clearly kept
 * watching past it. `tail` is everything after the last episode you hold, which
 * is the ordinary state of a show still airing or one you stopped collecting.
 * `head` is the mirror — episodes before the first one you hold, typical of
 * joining a series late.
 */
export type GapKind = 'hole' | 'tail' | 'head';

export const SCHEDULE_FILTERS = ['all', 'missing', 'holes', 'upcoming'] as const;
export type ScheduleFilter = (typeof SCHEDULE_FILTERS)[number];

export function isScheduleFilter(value: string): value is ScheduleFilter {
	return (SCHEDULE_FILTERS as readonly string[]).includes(value);
}

export interface ScheduleEpisode {
	id: string;
	serverId: string;
	showRatingKey: string;
	showTitle: string;
	year: number | null;
	thumb: string | null;
	season: number;
	episode: number;
	title: string | null;
	/** `YYYY-MM-DD`. Null only for announced episodes with no date yet. */
	airDate: string | null;
	status: EpisodeStatus;
	/** Set only when `status` is `missing`. */
	gap: GapKind | null;
	/** Set only when `status` is `upcoming`; negative values never occur. */
	daysUntil: number | null;
}

/** One season's shape, so a run of held episodes can be read at a glance
 *  instead of inferred from forty rows. */
export interface ScheduleSeason {
	season: number;
	held: number;
	/** Episodes that have aired, held or not. */
	aired: number;
	missing: number;
	holes: number;
	/** Compressed episode numbers, e.g. `E01–E04, E07`. */
	heldRuns: string;
	missingRuns: string;
}

export interface ScheduleShow {
	id: string;
	serverId: string;
	showRatingKey: string;
	showTitle: string;
	year: number | null;
	thumb: string | null;
	held: number;
	missing: number;
	holes: number;
	upcoming: number;
	/** Most recent air date among this show's missing episodes, for ordering. */
	newestMissing: string | null;
	nextAirDate: string | null;
	seasons: ScheduleSeason[];
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

export interface ScheduleReport {
	episodes: ScheduleEpisode[];
	shows: ScheduleShow[];
	counts: { held: number; missing: number; holes: number; upcoming: number };
	unknownAirDate: number;
	coverage: MissingCoverage;
	heldSeasonsOnly: boolean;
	truncated: boolean;
}

export interface ScheduleOptions {
	serverIds?: string[];
	/**
	 * Restrict gaps to seasons the server holds at least one episode of.
	 *
	 * On by default, and the single biggest source of false positives when off:
	 * someone who keeps only the current season of a long-running show is not
	 * "missing" the other nine, they threw them away on purpose.
	 */
	heldSeasonsOnly?: boolean;
	/** Limit to one show, for the expanded view. */
	showRatingKey?: string;
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

/** Compresses `[1,2,3,5]` to `E01–E03, E05`. A season's shape is the thing you
 *  actually want to see; a comma-separated list of forty numbers is not. */
function compressRuns(numbers: number[]): string {
	if (numbers.length === 0) return '';
	const sorted = [...numbers].sort((a, b) => a - b);
	const pad = (value: number) => `E${String(value).padStart(2, '0')}`;
	const parts: string[] = [];

	let runStart = sorted[0];
	let previous = sorted[0];

	for (let i = 1; i <= sorted.length; i++) {
		const current = sorted[i];
		if (current === previous + 1) {
			previous = current;
			continue;
		}
		parts.push(runStart === previous ? pad(runStart) : `${pad(runStart)}–${pad(previous)}`);
		runStart = current;
		previous = current;
	}

	return parts.join(', ');
}

/**
 * Every episode of every tracked show, marked held / missing / upcoming.
 *
 * Grouping by season before classifying is what makes `hole` detectable: the
 * classification depends on where an episode sits relative to the ones you
 * hold, which can't be decided a row at a time.
 */
export async function getSchedule(
	accountId: number,
	timeZone: string,
	{ serverIds = [], heldSeasonsOnly = true, showRatingKey }: ScheduleOptions = {}
): Promise<ScheduleReport> {
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
			.where(
				and(
					scope,
					gt(canonicalEpisodes.season, 0),
					isNotNull(canonicalEpisodes.airDate),
					showRatingKey ? eq(shows.ratingKey, showRatingKey) : undefined
				)
			)
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

	// Bucket by show, then by season, so classification can see a season whole.
	type Row = (typeof rows)[number];
	const byShow = new Map<string, { meta: Row; seasons: Map<number, Row[]> }>();

	for (const row of rows) {
		// A show the servers hold nothing of isn't one you're missing episodes
		// from — it's one you never started. Reporting it would bury real gaps.
		if (!held.get(`${row.serverId}:${row.sectionKey}:${row.showTitle}`)) continue;

		const key = `${row.serverId}:${row.showRatingKey}`;
		let entry = byShow.get(key);
		if (!entry) byShow.set(key, (entry = { meta: row, seasons: new Map() }));

		const season = entry.seasons.get(row.season);
		if (season) season.push(row);
		else entry.seasons.set(row.season, [row]);
	}

	const episodes: ScheduleEpisode[] = [];
	const showSummaries: ScheduleShow[] = [];
	const counts = { held: 0, missing: 0, holes: 0, upcoming: 0 };

	for (const [showKey, entry] of byShow) {
		const owner = held.get(
			`${entry.meta.serverId}:${entry.meta.sectionKey}:${entry.meta.showTitle}`
		)!;
		const summary: ScheduleShow = {
			id: showKey,
			serverId: entry.meta.serverId,
			showRatingKey: entry.meta.showRatingKey,
			showTitle: entry.meta.showTitle,
			year: entry.meta.year,
			thumb: entry.meta.thumb,
			held: 0,
			missing: 0,
			holes: 0,
			upcoming: 0,
			newestMissing: null,
			nextAirDate: null,
			seasons: []
		};

		for (const [season, seasonRows] of [...entry.seasons].sort((a, b) => a[0] - b[0])) {
			const ordered = [...seasonRows].sort((a, b) => a.episode - b.episode);
			const heldNumbers = ordered
				.filter((row) => owner.pairs.has(`${season}:${row.episode}`))
				.map((row) => row.episode);

			// The held span is what turns an absence into a hole rather than a tail.
			const firstHeld = heldNumbers.length ? heldNumbers[0] : null;
			const lastHeld = heldNumbers.length ? heldNumbers[heldNumbers.length - 1] : null;

			const seasonSummary: ScheduleSeason = {
				season,
				held: heldNumbers.length,
				aired: 0,
				missing: 0,
				holes: 0,
				heldRuns: compressRuns(heldNumbers),
				missingRuns: ''
			};
			const missingNumbers: number[] = [];

			for (const row of ordered) {
				const airDate = row.airDate!;
				const isHeld = owner.pairs.has(`${season}:${row.episode}`);
				const upcoming = airDate > today;
				if (!upcoming) seasonSummary.aired++;

				// Beyond the horizon an episode is an announcement, not something to
				// act on, so it drops out of the list and the counts alike.
				const daysUntil = upcoming ? daysBetween(today, airDate) : null;
				if (upcoming && (daysUntil ?? 0) > UPCOMING_HORIZON_DAYS) continue;

				let gap: GapKind | null = null;
				if (!isHeld && !upcoming) {
					// A season you hold nothing of is a deliberate omission, not a gap —
					// unless the caller has asked to see those too.
					if (heldSeasonsOnly && firstHeld === null) continue;
					gap =
						firstHeld !== null &&
						lastHeld !== null &&
						row.episode > firstHeld &&
						row.episode < lastHeld
							? 'hole'
							: firstHeld !== null && row.episode < firstHeld
								? 'head'
								: 'tail';
				}

				const status: EpisodeStatus = upcoming ? 'upcoming' : isHeld ? 'held' : 'missing';

				episodes.push({
					id: `${showKey}:${season}:${row.episode}`,
					serverId: row.serverId,
					showRatingKey: row.showRatingKey,
					showTitle: row.showTitle,
					year: row.year,
					thumb: row.thumb,
					season,
					episode: row.episode,
					title: row.title,
					airDate,
					status,
					gap,
					daysUntil
				});

				if (status === 'held') {
					counts.held++;
					summary.held++;
				} else if (status === 'upcoming') {
					counts.upcoming++;
					summary.upcoming++;
					if (!summary.nextAirDate || airDate < summary.nextAirDate) summary.nextAirDate = airDate;
				} else {
					counts.missing++;
					summary.missing++;
					missingNumbers.push(row.episode);
					seasonSummary.missing++;
					if (gap === 'hole') {
						counts.holes++;
						summary.holes++;
						seasonSummary.holes++;
					}
					if (!summary.newestMissing || airDate > summary.newestMissing) {
						summary.newestMissing = airDate;
					}
				}
			}

			seasonSummary.missingRuns = compressRuns(missingNumbers);
			summary.seasons.push(seasonSummary);
		}

		if (summary.held || summary.missing || summary.upcoming) showSummaries.push(summary);
	}

	// Newest first: what aired most recently is what you'd act on.
	episodes.sort((a, b) => (b.airDate ?? '').localeCompare(a.airDate ?? ''));

	// Holes lead — an interior gap means a download actually failed, where a tail
	// usually just means the show is still airing.
	showSummaries.sort(
		(a, b) =>
			b.holes - a.holes ||
			b.missing - a.missing ||
			(b.newestMissing ?? '').localeCompare(a.newestMissing ?? '')
	);

	return {
		episodes,
		shows: showSummaries,
		counts,
		unknownAirDate: Number(unknown?.n ?? 0),
		coverage,
		heldSeasonsOnly,
		truncated
	};
}
