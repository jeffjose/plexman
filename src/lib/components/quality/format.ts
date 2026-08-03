/**
 * Display helpers shared by the quality views.
 *
 * A plain module rather than a component because three of the five panels need
 * the same byte and bitrate formatting, and a size rendered as "1.4 TB" in one
 * panel and "1,438 GB" in the next would read as two different numbers.
 *
 * The tier and codec labels live here too, rather than beside the query that
 * produces the keys: `$lib/server` can't be imported into a client bundle, and
 * a label is a presentation decision anyway.
 */

export const TIER_LABELS: Record<string, string> = {
	top: 'Top 10%',
	high: '75th–89th',
	mid: '50th–74th',
	low: '25th–49th',
	bottom: 'Bottom 25%'
};

export const CODEC_GROUPS = ['hevc', 'h264', 'other'] as const;

export const CODEC_LABELS: Record<string, string> = {
	hevc: 'HEVC',
	h264: 'H.264',
	other: 'Other'
};

/**
 * Bytes as a storage figure — "2.4 TB", "870 GB", "412 MB".
 *
 * Powers of 1024 with the short unit names, matching what Plex and every disk
 * utility on the server itself reports. Using powers of 1000 here would be more
 * defensible in the abstract and less useful in practice: the number would
 * never agree with the one the user sees in `df`.
 */
export function formatBytes(bytes: number): string {
	if (!bytes) return '0 GB';

	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	let value = Math.abs(bytes);
	let unit = 0;

	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}

	const decimals = value >= 100 || unit <= 2 ? 0 : 1;
	return `${(bytes < 0 ? -value : value).toFixed(decimals)} ${units[unit]}`;
}

/** Gigabytes as a bare number, for chart axes where the unit is in the label. */
export function toGigabytes(bytes: number): number {
	return bytes / 1024 ** 3;
}

/** Kbps as Plex reports it — "12.4 Mbps" for video, "320 kbps" for audio. */
export function formatBitrate(kbps: number | null): string {
	if (kbps == null || kbps <= 0) return '—';
	if (kbps < 1000) return `${Math.round(kbps)} kbps`;
	return `${(kbps / 1000).toFixed(kbps >= 10_000 ? 0 : 1)} Mbps`;
}

/** `2024-07` → `Jul ’24`. */
export function formatMonth(month: string): string {
	const names = [
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
	return `${names[Number(month.slice(5, 7)) - 1]} ’${month.slice(2, 4)}`;
}

export function formatShare(part: number, whole: number): string {
	if (!whole) return '0%';
	const share = (part / whole) * 100;
	return share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`;
}

/**
 * A five-step ramp of the foreground colour, brightest first.
 *
 * The quality tiers are ordinal, not categorical — "top 10%" is more of the
 * same thing than "75th–89th", not a different thing — so they get intensity
 * rather than hue, exactly as the heatmap's levels do. Hue is reserved for
 * dimensions where the categories genuinely differ, like codec.
 */
export function rampColor(step: number, steps: number): string {
	const alpha = Math.round(88 - (step / Math.max(1, steps - 1)) * 68);
	return `color-mix(in oklch, var(--foreground) ${alpha}%, transparent)`;
}

/**
 * A stable colour per library, for the stacked storage bars.
 *
 * Generated from the index rather than taken from the theme because there are
 * only four media-type tokens and a collection can easily hold eight libraries.
 * The lightness and chroma are fixed so no library reads as more important than
 * another; only the hue moves, by a large enough step that adjacent stacks stay
 * distinguishable.
 */
export function sectionColor(index: number): string {
	return `oklch(0.72 0.13 ${(index * 67 + 250) % 360})`;
}
