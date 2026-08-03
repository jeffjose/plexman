/**
 * Read models for the activity views.
 *
 * Day bucketing happens in JS, not SQL. `viewedAt` is a UTC instant and the
 * heatmap is a grid of *local* days, so the two only line up if the conversion
 * knows the viewer's IANA zone — something SQLite can't do (its `localtime`
 * modifier uses the server's zone, which is only accidentally right). The
 * heatmap query therefore selects a single integer column and buckets it here;
 * even a hundred thousand of those is a millisecond of work.
 */

import { and, eq, gte, lte, inArray, desc, sql, like, or, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { history, servers } from '../db/schema';
import { dayKeyInZone } from '$lib/activity/dates';
import type { MediaType, TimelineItem } from '$lib/activity/types';
import { normalizeType } from '$lib/activity/types';

/**
 * Whose history to include.
 *
 * `null` means the signed-in user on every server, which is resolved from
 * `servers.serverAccountId` rather than hardcoded — the owner is id 1 on one
 * server and something else on the next. `'all'` drops the restriction, and an
 * explicit `serverId:accountId` pins it to one person on one server.
 */
export type ViewerScope = string | null;

export interface ActivityFilters {
	viewer?: ViewerScope;
	types?: MediaType[];
	serverIds?: string[];
	/** Inclusive unix-second bounds. */
	from?: number;
	to?: number;
	search?: string;
}

function buildFilters(accountId: number, filters: ActivityFilters): SQL | undefined {
	const clauses: (SQL | undefined)[] = [eq(history.accountId, accountId)];

	/*
	 * Viewer restriction, expressed on the (server, server-account) pair.
	 *
	 * A bare `serverAccountId IN (…)` would be wrong: local ids are only unique
	 * within a server, so "account 1" matches the owner on one server and a
	 * different person on another.
	 */
	if (filters.viewer === undefined || filters.viewer === null) {
		clauses.push(
			sql`(${history.serverId}, ${history.serverAccountId}) IN (
				SELECT ${servers.clientIdentifier}, ${servers.serverAccountId}
				FROM ${servers}
				WHERE ${servers.accountId} = ${accountId} AND ${servers.serverAccountId} IS NOT NULL
			)`
		);
	} else if (filters.viewer !== 'all') {
		const [viewerServer, viewerAccount] = filters.viewer.split(':');
		const parsed = Number(viewerAccount);
		clauses.push(
			Number.isFinite(parsed)
				? and(eq(history.serverId, viewerServer), eq(history.serverAccountId, parsed))
				: sql`1 = 0`
		);
	}

	if (filters.types?.length) {
		// 'other' is a UI bucket, not a Plex type: it means "anything that isn't
		// one of the three known types", so it can't be matched with IN.
		const known = filters.types.filter((type) => type !== 'other');
		const wantsOther = filters.types.includes('other');

		if (wantsOther && known.length) {
			clauses.push(
				or(inArray(history.type, known), sql`${history.type} NOT IN ('movie', 'episode', 'track')`)
			);
		} else if (wantsOther) {
			clauses.push(sql`${history.type} NOT IN ('movie', 'episode', 'track')`);
		} else if (known.length) {
			clauses.push(inArray(history.type, known));
		}
	}

	if (filters.serverIds?.length) clauses.push(inArray(history.serverId, filters.serverIds));
	if (filters.from !== undefined) clauses.push(gte(history.viewedAt, filters.from));
	if (filters.to !== undefined) clauses.push(lte(history.viewedAt, filters.to));

	if (filters.search?.trim()) {
		const term = `%${filters.search.trim()}%`;
		clauses.push(
			or(
				like(history.title, term),
				like(history.grandparentTitle, term),
				like(history.parentTitle, term)
			)
		);
	}

	return and(...clauses.filter(Boolean));
}

export interface DayBucket {
	/** Local calendar day, `YYYY-MM-DD`. */
	date: string;
	count: number;
	byType: Record<MediaType, number>;
}

export interface ActivitySummary {
	days: DayBucket[];
	total: number;
	firstDate: string | null;
	lastDate: string | null;
	/** Distinct local days with at least one view. */
	activeDays: number;
	busiestDay: DayBucket | null;
	currentStreak: number;
	longestStreak: number;
	byType: Record<MediaType, number>;
	/** Years present in the data, descending — drives the year switcher. */
	years: number[];
}

export async function getActivitySummary(
	accountId: number,
	timeZone: string,
	filters: ActivityFilters = {}
): Promise<ActivitySummary> {
	const rows = await db
		.select({ viewedAt: history.viewedAt, type: history.type })
		.from(history)
		.where(buildFilters(accountId, filters))
		.orderBy(history.viewedAt);

	const buckets = new Map<string, DayBucket>();
	const byType: Record<MediaType, number> = { movie: 0, episode: 0, track: 0, other: 0 };

	for (const row of rows) {
		const date = dayKeyInZone(row.viewedAt, timeZone);
		const type = normalizeType(row.type);

		let bucket = buckets.get(date);
		if (!bucket) {
			bucket = { date, count: 0, byType: { movie: 0, episode: 0, track: 0, other: 0 } };
			buckets.set(date, bucket);
		}
		bucket.count++;
		bucket.byType[type]++;
		byType[type]++;
	}

	const days = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
	const { current, longest } = computeStreaks(
		days.map((day) => day.date),
		dayKeyInZone(Math.floor(Date.now() / 1000), timeZone)
	);

	const years = [...new Set(days.map((day) => Number(day.date.slice(0, 4))))].sort((a, b) => b - a);

	return {
		days,
		total: rows.length,
		firstDate: days[0]?.date ?? null,
		lastDate: days.at(-1)?.date ?? null,
		activeDays: days.length,
		busiestDay: days.reduce<DayBucket | null>(
			(best, day) => (!best || day.count > best.count ? day : best),
			null
		),
		currentStreak: current,
		longestStreak: longest,
		byType,
		years
	};
}

/**
 * Consecutive-day streaks over a sorted list of active day keys.
 *
 * The current streak counts back from today, but tolerates today being empty —
 * otherwise the number would read 0 all morning and then jump, which is
 * misleading rather than informative.
 */
function computeStreaks(sortedDays: string[], today: string): { current: number; longest: number } {
	if (sortedDays.length === 0) return { current: 0, longest: 0 };

	const dayNumber = (key: string) =>
		Math.floor(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000);

	const numbers = sortedDays.map(dayNumber);
	let longest = 1;
	let run = 1;
	for (let i = 1; i < numbers.length; i++) {
		run = numbers[i] === numbers[i - 1] + 1 ? run + 1 : 1;
		if (run > longest) longest = run;
	}

	const todayNumber = dayNumber(today);
	const lastNumber = numbers.at(-1)!;
	let current = 0;
	if (todayNumber - lastNumber <= 1) {
		current = 1;
		for (let i = numbers.length - 1; i > 0; i--) {
			if (numbers[i] === numbers[i - 1] + 1) current++;
			else break;
		}
	}

	return { current, longest };
}

export interface TimelinePage {
	items: TimelineItem[];
	/** Opaque keyset cursor for the next page; null when exhausted. */
	nextCursor: string | null;
}

function encodeCursor(viewedAt: number, historyKey: string): string {
	return Buffer.from(`${viewedAt}|${historyKey}`).toString('base64url');
}

function decodeCursor(cursor: string): { viewedAt: number; historyKey: string } | null {
	try {
		const [viewedAt, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
		const parsed = Number(viewedAt);
		if (!Number.isFinite(parsed) || rest.length === 0) return null;
		return { viewedAt: parsed, historyKey: rest.join('|') };
	} catch {
		return null;
	}
}

/**
 * A page of the timeline, newest first.
 *
 * Keyset pagination on (viewedAt, historyKey) rather than OFFSET: the timeline
 * is scrolled continuously and OFFSET degrades badly deep into a long history,
 * while a keyset stays flat and can't skip or repeat rows if a sync inserts
 * while the user is scrolling.
 */
export async function getTimeline(
	accountId: number,
	{ cursor, limit = 50, ...filters }: ActivityFilters & { cursor?: string; limit?: number } = {}
): Promise<TimelinePage> {
	const base = buildFilters(accountId, filters);
	const decoded = cursor ? decodeCursor(cursor) : null;

	const where = decoded
		? and(
				base,
				sql`(${history.viewedAt}, ${history.historyKey}) < (${decoded.viewedAt}, ${decoded.historyKey})`
			)
		: base;

	const rows = await db
		.select()
		.from(history)
		.where(where)
		.orderBy(desc(history.viewedAt), desc(history.historyKey))
		.limit(limit + 1);

	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;

	const items: TimelineItem[] = page.map((row) => {
		const type = normalizeType(row.type);
		const isEpisode = type === 'episode';

		return {
			serverId: row.serverId,
			historyKey: row.historyKey,
			type,
			rawType: row.type,
			// For episodes the show is the headline and the episode name the
			// detail; that's how you actually think about "what did I watch".
			title: isEpisode ? (row.grandparentTitle ?? row.title) : row.title,
			subtitle: isEpisode ? row.title : (row.grandparentTitle ?? row.parentTitle),
			seasonEpisode:
				isEpisode && row.parentIndex != null && row.index != null
					? `S${String(row.parentIndex).padStart(2, '0')}E${String(row.index).padStart(2, '0')}`
					: null,
			year: row.year,
			thumb: row.grandparentThumb ?? row.thumb,
			viewedAt: row.viewedAt,
			duration: row.duration
		};
	});

	const last = page.at(-1);
	return {
		items,
		nextCursor: hasMore && last ? encodeCursor(last.viewedAt, last.historyKey) : null
	};
}

/** Distinct servers that actually appear in stored history, for the filter UI. */
export async function getHistoryServers(accountId: number) {
	return db
		.select({ serverId: history.serverId, count: sql<number>`count(*)` })
		.from(history)
		.where(eq(history.accountId, accountId))
		.groupBy(history.serverId);
}
