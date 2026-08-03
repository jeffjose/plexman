/**
 * Date helpers shared by the server (bucketing history into days) and the
 * client (laying out the heatmap grid).
 *
 * Everything works in terms of `YYYY-MM-DD` day keys rather than Date objects.
 * A day key is unambiguous once the zone is fixed, cheap to compare and sort,
 * and — unlike a Date — can't silently drift by an hour across a DST boundary
 * when it gets passed around.
 */

/**
 * The local calendar day a UTC instant falls on, in a given IANA zone.
 *
 * Uses `en-CA` because its short date format is already ISO-ordered, which
 * avoids hand-assembling parts from `formatToParts`.
 */
export function dayKeyInZone(unixSeconds: number, timeZone: string): string {
	return formatterFor(timeZone).format(new Date(unixSeconds * 1000));
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
	let formatter = formatters.get(timeZone);
	if (!formatter) {
		try {
			formatter = new Intl.DateTimeFormat('en-CA', {
				timeZone,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			});
		} catch {
			// An unknown zone (a mangled header, an exotic client) shouldn't take
			// the page down; UTC is a defensible fallback.
			formatter = new Intl.DateTimeFormat('en-CA', {
				timeZone: 'UTC',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			});
		}
		formatters.set(timeZone, formatter);
	}
	return formatter;
}

/** Day keys are compared and stepped as integers via this "days since epoch"
 *  form, which sidesteps DST entirely — the arithmetic is on calendar days,
 *  not on elapsed time. */
export function dayKeyToNumber(key: string): number {
	return Math.floor(
		Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000
	);
}

export function numberToDayKey(dayNumber: number): string {
	return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
	return numberToDayKey(dayKeyToNumber(key) + days);
}

/** 0 = Sunday … 6 = Saturday, matching the heatmap's row order. */
export function weekdayOf(key: string): number {
	return new Date(`${key}T00:00:00Z`).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
	return dayKeyToNumber(to) - dayKeyToNumber(from);
}

export function todayKey(timeZone: string): string {
	return dayKeyInZone(Math.floor(Date.now() / 1000), timeZone);
}

const MONTH_NAMES = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthLabel(key: string): string {
	return MONTH_NAMES[+key.slice(5, 7) - 1];
}

/** e.g. "Tuesday, 3 June 2025" — the heatmap tooltip heading. */
export function formatDayLong(key: string): string {
	return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

export function formatTime(unixSeconds: number, timeZone?: string): string {
	return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, {
		hour: 'numeric',
		minute: '2-digit',
		timeZone
	});
}

/** Compact relative age for timeline day headers — "today", "3d ago", "2y ago". */
export function relativeDay(key: string, today: string): string {
	const diff = daysBetween(key, today);
	if (diff === 0) return 'today';
	if (diff === 1) return 'yesterday';
	if (diff < 7) return `${diff}d ago`;
	if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
	if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
	return `${Math.floor(diff / 365)}y ago`;
}

/**
 * The unix-second bounds of a local calendar day.
 *
 * Built by walking one day key forward rather than adding 86,400 seconds, so a
 * day that is 23 or 25 hours long across a DST change still selects exactly
 * that day.
 */
export function dayBounds(dayKey: string, timeZone: string): { from: number; to: number } {
	return {
		from: zonedDayStart(dayKey, timeZone),
		to: zonedDayStart(addDays(dayKey, 1), timeZone) - 1
	};
}

/**
 * Midnight of a local day, as a unix timestamp.
 *
 * There's no direct API for "this wall-clock time in this zone", so this takes
 * the standard approach: guess with the naive UTC instant, ask what wall-clock
 * time that actually is in the target zone, and correct by the difference. The
 * second pass matters near a DST boundary, where the first guess can land on
 * the wrong side of the transition and pick up the wrong offset.
 */
export function zonedDayStart(dayKey: string, timeZone: string): number {
	const naive = Date.UTC(+dayKey.slice(0, 4), +dayKey.slice(5, 7) - 1, +dayKey.slice(8, 10));
	const corrected = naive - zoneOffsetMs(naive, timeZone);
	return Math.floor((naive - zoneOffsetMs(corrected, timeZone)) / 1000);
}

/** How far ahead of UTC `timeZone` is at a given instant, in milliseconds. */
function zoneOffsetMs(instant: number, timeZone: string): number {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});

	const parts: Record<string, number> = {};
	for (const part of formatter.formatToParts(new Date(instant))) {
		if (part.type !== 'literal') parts[part.type] = Number(part.value);
	}

	return (
		Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
		instant
	);
}

/** Milliseconds → "1h 42m" / "48m" / "35s". Plex durations are in ms. */
export function formatDuration(ms: number | null | undefined): string | null {
	if (!ms || ms <= 0) return null;
	const totalMinutes = Math.round(ms / 60_000);
	if (totalMinutes < 1) return `${Math.round(ms / 1000)}s`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
