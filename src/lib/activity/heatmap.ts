/**
 * Grid layout for the calendar heatmap.
 *
 * The grid is columns-of-weeks, rows-of-weekdays — the GitHub arrangement —
 * which is why the range is padded out to whole weeks: a partial first column
 * would put January's first day on the wrong row and shear the whole year.
 */

import { addDays, dayKeyToNumber, numberToDayKey, weekdayOf, monthLabel } from './dates';
import type { MediaType } from './types';

export interface HeatmapDay {
	date: string;
	count: number;
	byType: Record<MediaType, number>;
}

export interface HeatmapCell {
	date: string;
	count: number;
	byType: Record<MediaType, number>;
	/** 0 = no activity, 1–4 = increasing intensity. */
	level: number;
	dominantType: MediaType | null;
	/** Outside the requested range — rendered as a hole so the grid stays square. */
	filler: boolean;
}

export interface HeatmapWeek {
	/** Day key of the column's Sunday, used as a stable keyed-each identity. */
	key: string;
	cells: HeatmapCell[];
}

export interface MonthMarker {
	/** Index of the week column the month starts in. */
	weekIndex: number;
	label: string;
	year: number;
	/** True for January, which also gets the year printed. */
	isYearStart: boolean;
}

export interface HeatmapGrid {
	weeks: HeatmapWeek[];
	months: MonthMarker[];
	maxCount: number;
	/** Week-column index where each year begins, for the year jump buttons. */
	yearOffsets: Map<number, number>;
}

/**
 * Buckets counts into four intensity levels.
 *
 * Thresholds come from the 98th percentile rather than the maximum: a single
 * all-day binge would otherwise compress every ordinary day into level 1 and
 * flatten the whole chart. Clipping the tail keeps normal days legible.
 */
function buildScale(counts: number[]): (count: number) => number {
	if (counts.length === 0) return () => 0;

	const sorted = [...counts].sort((a, b) => a - b);
	const percentile = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
	const ceiling = Math.max(percentile, 1);

	return (count: number) => {
		if (count <= 0) return 0;
		if (count >= ceiling) return 4;
		const ratio = count / ceiling;
		if (ratio > 0.6) return 3;
		if (ratio > 0.3) return 2;
		return 1;
	};
}

function dominantOf(byType: Record<MediaType, number>): MediaType | null {
	let best: MediaType | null = null;
	let bestCount = 0;
	for (const [type, count] of Object.entries(byType) as [MediaType, number][]) {
		if (count > bestCount) {
			best = type;
			bestCount = count;
		}
	}
	return best;
}

/**
 * Builds the grid between two day keys, inclusive.
 *
 * Days with no activity still get a cell — the empty stretches are as much of
 * the picture as the busy ones, and a sparse grid with gaps would be unreadable.
 */
export function buildHeatmap(days: HeatmapDay[], from: string, to: string): HeatmapGrid {
	const byDate = new Map(days.map((day) => [day.date, day]));
	const scale = buildScale(days.map((day) => day.count));

	// Back up to the Sunday on or before `from`, and forward to the Saturday on
	// or after `to`, so every column holds exactly seven cells.
	const start = addDays(from, -weekdayOf(from));
	const end = addDays(to, 6 - weekdayOf(to));

	const weeks: HeatmapWeek[] = [];
	const months: MonthMarker[] = [];
	const yearOffsets = new Map<number, number>();

	let maxCount = 0;
	let lastMonth = '';

	const startNumber = dayKeyToNumber(start);
	const endNumber = dayKeyToNumber(end);

	for (let dayNumber = startNumber; dayNumber <= endNumber; dayNumber += 7) {
		const weekKey = numberToDayKey(dayNumber);
		const cells: HeatmapCell[] = [];

		for (let offset = 0; offset < 7; offset++) {
			const date = numberToDayKey(dayNumber + offset);
			const inRange = date >= from && date <= to;
			const day = inRange ? byDate.get(date) : undefined;
			const count = day?.count ?? 0;
			if (count > maxCount) maxCount = count;

			const byType = day?.byType ?? { movie: 0, episode: 0, track: 0, other: 0 };
			cells.push({
				date,
				count,
				byType,
				level: inRange ? scale(count) : 0,
				dominantType: count > 0 ? dominantOf(byType) : null,
				filler: !inRange
			});
		}

		// A month is labelled at the column containing its first in-range day, so
		// the label sits above where the month visually begins.
		const firstReal = cells.find((cell) => !cell.filler);
		if (firstReal) {
			const month = firstReal.date.slice(0, 7);
			if (month !== lastMonth) {
				const year = Number(firstReal.date.slice(0, 4));
				const isYearStart = firstReal.date.slice(5, 7) === '01' || months.length === 0;
				months.push({
					weekIndex: weeks.length,
					label: monthLabel(firstReal.date),
					year,
					isYearStart
				});
				if (!yearOffsets.has(year)) yearOffsets.set(year, weeks.length);
				lastMonth = month;
			}
		}

		weeks.push({ key: weekKey, cells });
	}

	return { weeks, months, maxCount, yearOffsets };
}

/**
 * Cell fill.
 *
 * Hue carries *what* was watched (the dominant media type) and opacity carries
 * *how much*, so a glance at the chart reads both dimensions at once. Empty
 * days get a faint neutral tint rather than nothing, which is what makes the
 * grid legible as a grid.
 */
export function cellColor(cell: HeatmapCell): string {
	if (cell.filler) return 'transparent';
	if (cell.level === 0) return 'color-mix(in oklch, var(--foreground) 7%, transparent)';

	const base = cell.dominantType ? `var(--type-${cell.dominantType})` : 'var(--type-other)';
	const alpha = [0, 28, 48, 72, 100][cell.level];
	return `color-mix(in oklch, ${base} ${alpha}%, transparent)`;
}
