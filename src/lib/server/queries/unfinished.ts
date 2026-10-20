/**
 * Read models for the unfinished view — what was started and abandoned, and
 * what has never been touched at all.
 *
 * The shape of this page is dictated by one missing column: we don't store
 * `viewOffset`. A history row records that something was *played*, not that it
 * was finished, so "started a film and stopped halfway" is not derivable and
 * isn't guessed at. What is derivable is episode coverage — an episode either
 * has a history row or it doesn't — which is why progress is only ever
 * expressed per show, and why films appear here only in the never-played sense.
 *
 * The rollup runs in JS rather than SQL for the reason `activity.ts` gives:
 * "idle for 90 days" is a count of *local* calendar days, which SQLite can't
 * compute. Doing the grouping here too keeps the resume-point logic — the next
 * unplayed episode *after* where you stopped — readable, which it is not as a
 * correlated subquery.
 */

import { and, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { history, libraryItems, librarySections, servers } from '../db/schema';
import { dayKeyInZone, daysBetween, todayKey } from '#lib/activity/dates.js';
import type {
	DeadWeightItem,
	DeadWeightKind,
	NextEpisode,
	PartWatchedShow,
	UnfinishedSummary
} from '#lib/components/unfinished/types.js';

/**
 * Idle days after which a part-watched show stops counting as "in progress".
 *
 * Two weeks is roughly a weekly-release cadence plus a missed week, so a show
 * you're keeping up with never appears here. Anything past it has stopped being
 * a habit, which is the thing worth surfacing.
 */
export const STALE_AFTER_DAYS = 14;

/** Episodes represented in a progress strip before it stops being complete. */
const MAX_MARKERS = 200;

/**
 * Idle days after which it's treated as dropped rather than merely stale.
 *
 * A quarter is long enough that the gap can't be explained by a break between
 * seasons or a holiday — the distinction the two lists exist to draw.
 */
export const DROPPED_AFTER_DAYS = 90;

/** Ranked dead-weight groups returned. The list is a triage queue, not an
 *  inventory: past a couple of hundred rows nobody is still reading. */
const DEAD_WEIGHT_LIMIT = 250;

const sectionId = sql<string>`${libraryItems.serverId} || ':' || ${libraryItems.sectionKey}`;

function libraryScope(accountId: number, serverIds: string[]): SQL | undefined {
	return and(
		sql`${libraryItems.serverId} IN (SELECT ${servers.clientIdentifier} FROM ${servers} WHERE ${servers.accountId} = ${accountId})`,
		// Muted libraries drop out here exactly as they do in library.ts, so a
		// hidden music library can't turn up as the largest thing you could delete.
		sql`${sectionId} NOT IN (
			SELECT ${librarySections.serverId} || ':' || ${librarySections.sectionKey}
			FROM ${librarySections} WHERE ${librarySections.hidden} = 1
		)`,
		serverIds.length ? inArray(libraryItems.serverId, serverIds) : undefined
	);
}

interface Group {
	serverId: string;
	sectionKey: string;
	kind: DeadWeightKind;
	title: string;
	subtitle: string | null;
	year: number | null;
	thumb: string | null;
	owned: number;
	watched: number;
	lastViewedAt: number;
	lastSeason: number | null;
	lastEpisode: number | null;
	newestAddedAt: number;
	bytes: number | null;
	ms: number | null;
	unwatchedMs: number | null;
	unwatched: { season: number | null; episode: number | null; title: string }[];
	/** Every owned episode with whether it's been played, for the progress strip. */
	episodes: { season: number | null; episode: number | null; watched: boolean }[];
}

/** Sortable position of an episode. Nulls sort last rather than as zero, so a
 *  special without a number can't be mistaken for the season opener. */
function position(season: number | null, episode: number | null): number {
	return (season ?? 9_999) * 10_000 + (episode ?? 9_999);
}

export async function getUnfinished(
	accountId: number,
	timeZone: string,
	serverIds: string[] = []
): Promise<UnfinishedSummary> {
	const [items, plays, [firstPlay]] = await Promise.all([
		db
			.select({
				serverId: libraryItems.serverId,
				sectionKey: libraryItems.sectionKey,
				ratingKey: libraryItems.ratingKey,
				type: libraryItems.type,
				title: libraryItems.title,
				parentTitle: libraryItems.parentTitle,
				grandparentTitle: libraryItems.grandparentTitle,
				groupKey: libraryItems.groupKey,
				groupTitle: libraryItems.groupTitle,
				index: libraryItems.index,
				parentIndex: libraryItems.parentIndex,
				year: libraryItems.year,
				thumb: libraryItems.thumb,
				grandparentThumb: libraryItems.grandparentThumb,
				duration: libraryItems.duration,
				fileSize: libraryItems.fileSize,
				addedAt: libraryItems.addedAt
			})
			.from(libraryItems)
			.where(libraryScope(accountId, serverIds)),

		// One row per item ever played, carrying the latest play. Collapsing
		// repeats here rather than in JS keeps the map small — a comfort rewatch
		// can leave fifteen rows for the same episode.
		db
			.select({
				serverId: history.serverId,
				ratingKey: history.ratingKey,
				lastViewedAt: sql<number>`max(${history.viewedAt})`
			})
			.from(history)
			.where(
				and(
					eq(history.accountId, accountId),
					isNotNull(history.ratingKey),
					serverIds.length ? inArray(history.serverId, serverIds) : undefined
				)
			)
			.groupBy(history.serverId, history.ratingKey),

		db
			.select({ viewedAt: sql<number | null>`min(${history.viewedAt})` })
			.from(history)
			.where(
				and(
					eq(history.accountId, accountId),
					serverIds.length ? inArray(history.serverId, serverIds) : undefined
				)
			)
	]);

	const playedAt = new Map<string, number>();
	for (const play of plays) playedAt.set(`${play.serverId}:${play.ratingKey}`, play.lastViewedAt);

	const today = todayKey(timeZone);
	const groups = new Map<string, Group>();
	let sized = 0;

	for (const row of items) {
		const viewedAt = playedAt.get(`${row.serverId}:${row.ratingKey}`) ?? null;
		if (row.fileSize != null) sized++;

		const isEpisode = row.type === 'episode';
		// Episodes roll up to the show, not the season: "you stopped watching this
		// show" is the question, and a season boundary is not where you stopped.
		// Everything else rolls up to its pre-computed group — a film is its own
		// group, a track's is its album.
		const key = isEpisode
			? `${row.serverId}\0show\0${row.grandparentTitle ?? row.title}`
			: `${row.serverId}\0${row.groupKey}`;

		let group = groups.get(key);
		if (!group) {
			group = {
				serverId: row.serverId,
				sectionKey: row.sectionKey,
				kind: isEpisode ? 'show' : row.type === 'movie' ? 'movie' : 'album',
				title: isEpisode ? (row.grandparentTitle ?? row.title) : row.groupTitle,
				subtitle: isEpisode ? null : (row.grandparentTitle ?? row.parentTitle),
				// Episodes carry their own year, which is the season's, not the
				// show's — printing it beside a show title would just be wrong.
				year: isEpisode ? null : row.year,
				thumb: isEpisode
					? (row.grandparentThumb ?? row.thumb)
					: (row.thumb ?? row.grandparentThumb),
				owned: 0,
				watched: 0,
				lastViewedAt: 0,
				lastSeason: null,
				lastEpisode: null,
				newestAddedAt: row.addedAt,
				bytes: null,
				ms: null,
				unwatchedMs: null,
				unwatched: [],
				episodes: []
			};
			groups.set(key, group);
		}

		group.owned++;
		if (isEpisode) {
			group.episodes.push({
				season: row.parentIndex,
				episode: row.index,
				watched: viewedAt !== null
			});
		}
		if (row.addedAt > group.newestAddedAt) group.newestAddedAt = row.addedAt;
		if (row.fileSize != null) group.bytes = (group.bytes ?? 0) + row.fileSize;
		if (row.duration != null) group.ms = (group.ms ?? 0) + row.duration;

		if (viewedAt === null) {
			group.unwatched.push({ season: row.parentIndex, episode: row.index, title: row.title });
			if (row.duration != null) group.unwatchedMs = (group.unwatchedMs ?? 0) + row.duration;
			continue;
		}

		group.watched++;
		if (viewedAt > group.lastViewedAt) {
			group.lastViewedAt = viewedAt;
			group.lastSeason = row.parentIndex;
			group.lastEpisode = row.index;
		}
	}

	const dropped: PartWatchedShow[] = [];
	const stale: PartWatchedShow[] = [];
	const dead: { item: DeadWeightItem; score: number }[] = [];
	let activeShows = 0;
	let completedShows = 0;
	let deadItems = 0;
	let deadBytes: number | null = null;
	let deadMs: number | null = null;

	for (const [key, group] of groups) {
		if (group.watched === 0) {
			const ageDays = daysBetween(dayKeyInZone(group.newestAddedAt, timeZone), today);
			deadItems += group.owned;
			if (group.bytes != null) deadBytes = (deadBytes ?? 0) + group.bytes;
			if (group.ms != null) deadMs = (deadMs ?? 0) + group.ms;

			dead.push({
				// Bytes × age: a large file that arrived last week isn't dead weight
				// yet, and a tiny one from 2019 isn't worth the click. With no sizes
				// recorded this collapses to zero for everything and the tie-break
				// below carries the ordering, which is why it falls back to oldest-first.
				score: (group.bytes ?? 0) * Math.max(ageDays, 0),
				item: {
					id: key,
					serverId: group.serverId,
					sectionKey: group.sectionKey,
					kind: group.kind,
					title: group.title,
					subtitle: group.subtitle,
					year: group.year,
					thumb: group.thumb,
					itemCount: group.owned,
					bytes: group.bytes,
					ms: group.ms,
					addedAt: group.newestAddedAt,
					ageDays
				}
			});
			continue;
		}

		if (group.kind !== 'show' || group.owned === group.watched) {
			if (group.kind === 'show') completedShows++;
			continue;
		}

		const idleDays = daysBetween(dayKeyInZone(group.lastViewedAt, timeZone), today);
		if (idleDays < STALE_AFTER_DAYS) {
			activeShows++;
			continue;
		}

		group.unwatched.sort((a, b) => position(a.season, a.episode) - position(b.season, b.episode));

		const resume = position(group.lastSeason, group.lastEpisode);
		const ahead = group.unwatched.find(
			(episode) => position(episode.season, episode.episode) > resume
		);
		// Falling back to the earliest unplayed episode matters for a show watched
		// out of order: with nothing after the last play, what's left is a gap, and
		// saying so is more use than showing nothing.
		const candidate = ahead ?? group.unwatched[0];
		const next: NextEpisode | null = candidate
			? { ...candidate, behind: ahead === undefined }
			: null;

		/*
		 * Broadcast order, so the strip reads left to right as the show aired.
		 * Capped because the sequence crosses the wire and a long-running series
		 * would otherwise send hundreds of booleans no one can see individually;
		 * past the cap the strip is sampled rather than complete, and the header
		 * count remains the authority on totals.
		 */
		const ordered = [...group.episodes].sort(
			(a, b) => position(a.season, a.episode) - position(b.season, b.episode)
		);
		const markers = ordered.slice(0, MAX_MARKERS).map((episode) => episode.watched);
		const resumeIndex = ordered
			.slice(0, MAX_MARKERS)
			.findLastIndex((episode) => position(episode.season, episode.episode) === resume);

		const show: PartWatchedShow = {
			id: key,
			serverId: group.serverId,
			sectionKey: group.sectionKey,
			title: group.title,
			year: group.year,
			thumb: group.thumb,
			ownedEpisodes: group.owned,
			watchedEpisodes: group.watched,
			lastViewedAt: group.lastViewedAt,
			idleDays,
			lastSeason: group.lastSeason,
			lastEpisode: group.lastEpisode,
			next,
			remainingMs: group.unwatchedMs,
			skipped: group.unwatched.filter(
				(episode) => position(episode.season, episode.episode) < resume
			).length,
			markers,
			resumeIndex
		};

		(idleDays >= DROPPED_AFTER_DAYS ? dropped : stale).push(show);
	}

	const remaining = (show: PartWatchedShow) => show.ownedEpisodes - show.watchedEpisodes;
	const byIdle = (a: PartWatchedShow, b: PartWatchedShow) =>
		b.idleDays - a.idleDays || remaining(b) - remaining(a);

	dropped.sort(byIdle);
	stale.sort(byIdle);
	dead.sort(
		(a, b) =>
			b.score - a.score || b.item.ageDays - a.item.ageDays || b.item.itemCount - a.item.itemCount
	);

	return {
		dropped,
		stale,
		activeShows,
		completedShows,
		deadWeight: {
			items: dead.slice(0, DEAD_WEIGHT_LIMIT).map((entry) => entry.item),
			totalGroups: dead.length,
			totalItems: deadItems,
			totalBytes: deadBytes,
			totalMs: deadMs
		},
		haveSizes: sized > 0,
		historyFrom: firstPlay?.viewedAt ?? null,
		staleAfterDays: STALE_AFTER_DAYS,
		droppedAfterDays: DROPPED_AFTER_DAYS
	};
}
