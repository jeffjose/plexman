/**
 * Read model for the dashboard.
 *
 * Deliberately a composition of the existing per-feature queries rather than a
 * set of new ones. The home page's job is to agree with the pages it links to;
 * re-deriving "what's missing" here would give it a second implementation that
 * could quietly drift from the Schedule page's answer.
 *
 * The one thing it does define itself is the *window*, which is asymmetric on
 * purpose: about ten days back and two forward. An episode that aired last
 * Thursday is still downloadable and therefore still actionable, while one
 * airing next week is an announcement you can't use yet.
 */

import { and, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { history, libraryItems, librarySections, servers, shows } from '../db/schema';
import { addDays, dayKeyInZone, todayKey } from '$lib/activity/dates';
import { getSchedule, type ScheduleEpisode } from './schedule';
import { getActivitySummary, type DayBucket, type ViewerScope } from './activity';
import { getFitReport } from './quality';

/** How far the strip reaches back and forward, in days. */
export const ON_AIR_PAST_DAYS = 10;
export const ON_AIR_FUTURE_DAYS = 2;

/**
 * How recently a show must have been fed to count as one you're watching.
 *
 * The strip is about keeping up, so a series finished in 2022 doesn't belong on
 * it however incomplete it is. Being fed is a better signal than being watched:
 * you download the current season whether or not you've got round to it yet.
 */
const ACTIVE_WINDOW_DAYS = 150;

export interface HomeGap {
	id: string;
	serverId: string;
	showRatingKey: string;
	showTitle: string;
	thumb: string | null;
	season: number;
	/** Compressed episode numbers, e.g. `E05` or `E02, E07`. */
	episodes: string;
}

export interface HomeTiles {
	watchedThisWeek: number;
	streak: number;
	addedThisWeek: number;
	addedBytesThisWeek: number | null;
	totalBytes: number | null;
	bytesLast30Days: number | null;
	/** Share of scored video sitting inside the quality band, 0–100. Null when
	 *  no file details have been synced yet. */
	inBandPercent: number | null;
	overkillPercent: number | null;
	/** Items with a recorded file size, and the total in scope.
	 *
	 * Sizes arrive only for items a sync actually walked, so a library synced
	 * before the media columns existed reports a byte total covering a fraction
	 * of itself. Carrying the coverage lets the UI refuse to print a headline it
	 * can't stand behind rather than quietly understating the collection by an
	 * order of magnitude. */
	sizedItems: number;
	totalItems: number;
	/** Video items the fit band could actually judge. */
	scoredItems: number;
}

export interface HomeSync {
	lastSyncedAt: number | null;
	plays: number;
	items: number;
	showsChecked: number;
	showsIdentified: number;
	/** Servers that can't report other users, named so the footer can say why
	 *  a number looks short. */
	unowned: string[];
}

export interface HomeData {
	onAir: ScheduleEpisode[];
	onAirCounts: { missing: number; held: number; upcoming: number };
	gaps: HomeGap[];
	gapTotal: number;
	deadWeight: { titles: number; items: number; bytes: number | null } | null;
	tiles: HomeTiles;
	activityDays: DayBucket[];
	sync: HomeSync;
}

const MAX_GAPS = 6;

function unmutedScope(accountId: number, serverIds: string[]): SQL | undefined {
	return and(
		sql`${libraryItems.serverId} IN (SELECT ${servers.clientIdentifier} FROM ${servers} WHERE ${servers.accountId} = ${accountId})`,
		sql`${libraryItems.serverId} || ':' || ${libraryItems.sectionKey} NOT IN (
			SELECT ${librarySections.serverId} || ':' || ${librarySections.sectionKey}
			FROM ${librarySections} WHERE ${librarySections.hidden} = 1
		)`,
		serverIds.length ? inArray(libraryItems.serverId, serverIds) : undefined
	);
}

/** Shows fed recently enough to still be ones you're following. */
async function activeShowKeys(accountId: number, serverIds: string[]): Promise<Set<string>> {
	const cutoff = Math.floor(Date.now() / 1000) - ACTIVE_WINDOW_DAYS * 86_400;

	const rows = await db
		.select({ serverId: shows.serverId, ratingKey: shows.ratingKey })
		.from(shows)
		.where(
			and(
				sql`${shows.serverId} IN (SELECT ${servers.clientIdentifier} FROM ${servers} WHERE ${servers.accountId} = ${accountId})`,
				serverIds.length ? inArray(shows.serverId, serverIds) : undefined,
				gte(shows.lastEpisodeAddedAt, cutoff)
			)
		);

	return new Set(rows.map((row) => `${row.serverId}:${row.ratingKey}`));
}

function compress(numbers: number[]): string {
	const sorted = [...numbers].sort((a, b) => a - b);
	const pad = (value: number) => `E${String(value).padStart(2, '0')}`;
	const parts: string[] = [];

	let start = sorted[0];
	let previous = sorted[0];
	for (let i = 1; i <= sorted.length; i++) {
		const current = sorted[i];
		if (current === previous + 1) {
			previous = current;
			continue;
		}
		parts.push(start === previous ? pad(start) : `${pad(start)}–${pad(previous)}`);
		start = current;
		previous = current;
	}
	return parts.join(', ');
}

export async function getHomeData(
	accountId: number,
	timeZone: string,
	{ serverIds = [], viewer = null }: { serverIds?: string[]; viewer?: ViewerScope } = {}
): Promise<HomeData> {
	const today = todayKey(timeZone);
	const from = addDays(today, -ON_AIR_PAST_DAYS);
	const to = addDays(today, ON_AIR_FUTURE_DAYS);
	const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86_400;
	const monthAgo = Math.floor(Date.now() / 1000) - 30 * 86_400;
	const scope = unmutedScope(accountId, serverIds);

	const [
		schedule,
		active,
		activity,
		fit,
		weekAdds,
		totals,
		monthBytes,
		unplayed,
		allPlays,
		syncRow
	] = await Promise.all([
		getSchedule(accountId, timeZone, { serverIds }),
		activeShowKeys(accountId, serverIds),
		// Twelve weeks is all the strip draws, and bounding it keeps the
		// dashboard off a full-history scan.
		getActivitySummary(accountId, timeZone, {
			viewer,
			from: Math.floor(Date.now() / 1000) - 84 * 86_400
		}),
		getFitReport(accountId, { serverIds }),
		db
			.select({
				n: sql<number>`count(*)`,
				bytes: sql<number | null>`sum(${libraryItems.fileSize})`
			})
			.from(libraryItems)
			.where(and(scope, gte(libraryItems.addedAt, weekAgo))),
		db
			.select({
				n: sql<number>`count(*)`,
				sized: sql<number>`sum(case when ${libraryItems.fileSize} is not null then 1 else 0 end)`,
				bytes: sql<number | null>`sum(${libraryItems.fileSize})`
			})
			.from(libraryItems)
			.where(scope),
		db
			.select({ bytes: sql<number | null>`sum(${libraryItems.fileSize})` })
			.from(libraryItems)
			.where(and(scope, gte(libraryItems.addedAt, monthAgo))),
		// Never played: no history row anywhere for this item's rating key.
		db
			.select({
				items: sql<number>`count(*)`,
				titles: sql<number>`count(distinct ${libraryItems.groupKey})`,
				bytes: sql<number | null>`sum(${libraryItems.fileSize})`
			})
			.from(libraryItems)
			.leftJoin(
				history,
				and(
					eq(history.serverId, libraryItems.serverId),
					eq(history.ratingKey, libraryItems.ratingKey)
				)
			)
			.where(and(scope, isNull(history.historyKey))),
		db
			.select({ n: sql<number>`count(*)` })
			.from(history)
			.where(
				sql`${history.serverId} IN (SELECT ${servers.clientIdentifier} FROM ${servers} WHERE ${servers.accountId} = ${accountId})`
			),
		db
			.select({
				lastSyncedAt: sql<number | null>`max(${servers.lastSyncedAt})`,
				unowned: sql<
					string | null
				>`group_concat(case when ${servers.owned} = 0 then ${servers.name} end)`
			})
			.from(servers)
			.where(eq(servers.accountId, accountId))
	]);

	// The strip: the window, restricted to shows still being fed.
	const onAir = schedule.episodes
		.filter((episode) => {
			if (!episode.airDate || episode.airDate < from || episode.airDate > to) return false;
			return active.has(`${episode.serverId}:${episode.showRatingKey}`);
		})
		.sort((a, b) => (b.airDate ?? '').localeCompare(a.airDate ?? ''));

	const onAirCounts = {
		missing: onAir.filter((episode) => episode.status === 'missing').length,
		held: onAir.filter((episode) => episode.status === 'held').length,
		upcoming: onAir.filter((episode) => episode.status === 'upcoming').length
	};

	// Gaps are reference material here, so they're collapsed per show and season
	// rather than listed episode by episode.
	const holes = schedule.episodes.filter(
		(episode) =>
			episode.gap === 'hole' && active.has(`${episode.serverId}:${episode.showRatingKey}`)
	);

	const grouped = new Map<string, HomeGap & { numbers: number[] }>();
	for (const episode of holes) {
		const key = `${episode.serverId}:${episode.showRatingKey}:${episode.season}`;
		const existing = grouped.get(key);
		if (existing) {
			existing.numbers.push(episode.episode);
			continue;
		}
		grouped.set(key, {
			id: key,
			serverId: episode.serverId,
			showRatingKey: episode.showRatingKey,
			showTitle: episode.showTitle,
			thumb: episode.thumb,
			season: episode.season,
			episodes: '',
			numbers: [episode.episode]
		});
	}

	const gaps = [...grouped.values()]
		.map(({ numbers, ...gap }) => ({ ...gap, episodes: compress(numbers) }))
		.sort((a, b) => a.showTitle.localeCompare(b.showTitle));

	const watchedThisWeek = activity.days
		.filter((day) => day.date >= addDays(today, -6))
		.reduce((sum, day) => sum + day.count, 0);

	const unplayedRow = unplayed[0];
	const totalsRow = totals[0];
	const weekRow = weekAdds[0];

	return {
		onAir,
		onAirCounts,
		gaps: gaps.slice(0, MAX_GAPS),
		gapTotal: gaps.length,
		deadWeight: unplayedRow
			? {
					titles: Number(unplayedRow.titles ?? 0),
					items: Number(unplayedRow.items ?? 0),
					bytes: unplayedRow.bytes != null ? Number(unplayedRow.bytes) : null
				}
			: null,
		tiles: {
			watchedThisWeek,
			streak: activity.currentStreak,
			addedThisWeek: Number(weekRow?.n ?? 0),
			addedBytesThisWeek: weekRow?.bytes != null ? Number(weekRow.bytes) : null,
			totalBytes: totalsRow?.bytes != null ? Number(totalsRow.bytes) : null,
			bytesLast30Days: monthBytes[0]?.bytes != null ? Number(monthBytes[0].bytes) : null,
			inBandPercent:
				fit.scored > 0
					? ((fit.buckets.find((b) => b.verdict === 'good')?.items ?? 0) / fit.scored) * 100
					: null,
			overkillPercent:
				fit.scored > 0
					? ((fit.buckets.find((b) => b.verdict === 'overkill')?.items ?? 0) / fit.scored) * 100
					: null,
			sizedItems: Number(totalsRow?.sized ?? 0),
			totalItems: Number(totalsRow?.n ?? 0),
			scoredItems: fit.scored
		},
		activityDays: activity.days,
		sync: {
			lastSyncedAt: syncRow[0]?.lastSyncedAt ?? null,
			// All-time, not the twelve weeks the strip draws — the footer is a
			// statement about the database, not about the chart above it.
			plays: Number(allPlays[0]?.n ?? 0),
			items: Number(totalsRow?.n ?? 0),
			showsChecked: schedule.coverage.checked,
			showsIdentified: schedule.coverage.identified,
			unowned: (syncRow[0]?.unowned ?? '').split(',').filter(Boolean)
		}
	};
}

/** Local-day key for a history timestamp, exported so the strip and the
 *  calendar agree on where a day begins. */
export function dayOf(unixSeconds: number, timeZone: string): string {
	return dayKeyInZone(unixSeconds, timeZone);
}
