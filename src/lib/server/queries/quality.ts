/**
 * Read models for the quality view.
 *
 * Everything here is derived from columns the library sync already stores, so
 * the page answers questions a live Plex call can't: not "what is my library
 * like" but "what has it been becoming". That requires history, which only a
 * local copy has.
 *
 * The shape of the work is one wide scan plus two narrow top-N queries. The
 * scan is unavoidable — percentiles, monthly medians and cumulative storage all
 * need every row — and doing it once is cheaper than four passes that each
 * re-read the same table. The worklists stay in SQL because they only want the
 * biggest twenty-five rows and the ordering is indexed.
 */

import { and, desc, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { libraryItems, librarySections, servers } from '../db/schema';
import { dayKeyInZone } from '$lib/activity/dates';

export interface QualityFilters {
	/** Restrict to particular servers; empty/absent means all of them. */
	serverIds?: string[];
	/** Section keys as `serverId:sectionKey` composites — section keys are only
	 *  unique within a server. */
	sections?: string[];
}

const sectionId = sql<string>`${libraryItems.serverId} || ':' || ${libraryItems.sectionKey}`;

/**
 * The scope every query here shares.
 *
 * Deliberately a near-copy of `library.ts`'s private `buildFilters` rather than
 * an import: that one carries date, type and search clauses this page has no
 * use for, and exporting it would tie two views' filter vocabularies together
 * for the sake of a dozen lines. The one clause that must not drift is the
 * muted-library exclusion — quality stats that silently included a muted
 * library would contradict every other page.
 */
function scope(accountId: number, filters: QualityFilters): SQL | undefined {
	const clauses: (SQL | undefined)[] = [
		sql`${libraryItems.serverId} IN (SELECT ${servers.clientIdentifier} FROM ${servers} WHERE ${servers.accountId} = ${accountId})`,
		sql`${sectionId} NOT IN (
			SELECT ${librarySections.serverId} || ':' || ${librarySections.sectionKey}
			FROM ${librarySections} WHERE ${librarySections.hidden} = 1
		)`
	];

	if (filters.serverIds?.length) clauses.push(inArray(libraryItems.serverId, filters.serverIds));
	if (filters.sections?.length) clauses.push(inArray(sectionId, filters.sections));

	return and(...clauses.filter(Boolean));
}

/**
 * The page's own URL parsing.
 *
 * Lives here rather than in `queries/params.ts` because it reads only `section`
 * — `server` comes from the shared `parseServerScope` — and a third
 * near-identical filter parser in that module would be more code than this.
 */
export function parseQualityFilters(params: URLSearchParams, serverIds: string[]): QualityFilters {
	const filters: QualityFilters = {};

	if (serverIds.length) filters.serverIds = serverIds;

	const sections = params
		.getAll('section')
		.flatMap((value) => value.split(','))
		.filter(Boolean);
	if (sections.length) filters.sections = [...new Set(sections)];

	return filters;
}

// ---- Tiers ------------------------------------------------------------------

export type TierKey = 'top' | 'high' | 'mid' | 'low' | 'bottom';

/** Best first. The labels these are rendered with live in the components' own
 *  `format.ts` — a client bundle can't import from `$lib/server`. */
export const TIER_KEYS: TierKey[] = ['top', 'high', 'mid', 'low', 'bottom'];

function tierFor(percentile: number): TierKey {
	if (percentile >= 90) return 'top';
	if (percentile >= 75) return 'high';
	if (percentile >= 50) return 'mid';
	if (percentile >= 25) return 'low';
	return 'bottom';
}

/**
 * A section needs this many rated items before its percentiles mean anything.
 *
 * Below it, "top 10%" is just "the biggest of the four files here" — a claim
 * the number implies but the data can't support. Those items are reported as
 * unranked instead of being quietly folded into a tier.
 */
const MIN_RANKABLE = 10;

const emptyTiers = (): Record<TierKey, number> => ({
	top: 0,
	high: 0,
	mid: 0,
	low: 0,
	bottom: 0
});

/** Nearest-rank quantile over an ascending array. */
function quantile(sorted: number[], fraction: number): number | null {
	if (!sorted.length) return null;
	return sorted[Math.min(sorted.length - 1, Math.round(fraction * (sorted.length - 1)))];
}

// ---- Codecs -----------------------------------------------------------------

export type CodecGroup = 'hevc' | 'h264' | 'other';

/** Plex reports the same codec under several names depending on how the file
 *  was muxed, and `avc1` vs `h264` is a distinction nobody storing films cares
 *  about. */
function codecGroup(codec: string | null): CodecGroup {
	if (!codec) return 'other';
	const value = codec.toLowerCase();
	if (value === 'hevc' || value === 'h265' || value === 'x265') return 'hevc';
	if (value === 'h264' || value === 'avc' || value === 'avc1' || value === 'x264') return 'h264';
	return 'other';
}

const RESOLUTION_ORDER = ['4k', '1080', '720', 'sd'];

const RESOLUTION_LABELS: Record<string, string> = {
	'4k': '4K',
	'1080': '1080p',
	'720': '720p',
	sd: 'SD'
};

// ---- Overview ---------------------------------------------------------------

export interface MixEntry {
	key: string;
	label: string;
	count: number;
	bytes: number;
}

export interface SectionQuality {
	id: string;
	/** Items in scope, whether or not they carry media details. */
	items: number;
	/** Items with a bitrate, i.e. those the percentiles are computed over. */
	rated: number;
	ranked: boolean;
	bytes: number;
	tiers: Record<TierKey, number>;
	/** Kbps thresholds, so a percentile can be read as a real number. */
	p25: number | null;
	p50: number | null;
	p75: number | null;
	p90: number | null;
}

export interface QualityMonth {
	/** `YYYY-MM`, in the viewer's zone. */
	month: string;
	items: number;
	bytes: number;
	cumulativeBytes: number;
	/** Median kbps of the *video* items added that month, or null if none were.
	 *  Music is excluded: a 320 kbps track and a 12 Mbps film share no scale, and
	 *  a median across both tracks whichever happened to arrive in bulk. */
	medianBitrate: number | null;
	videoItems: number;
	codecs: Record<CodecGroup, number>;
	/** Bytes added, keyed by `serverId:sectionKey`. */
	bySection: Record<string, number>;
}

export interface QualityOverview {
	items: number;
	/** Items carrying a bitrate. Zero across the board means the media columns
	 *  have never been synced, which the page treats as its empty state. */
	rated: number;
	sized: number;
	totalBytes: number;
	tiers: { key: TierKey; count: number; bytes: number }[];
	/** Rated items in sections too small to rank — see `MIN_RANKABLE`. */
	unranked: number;
	sections: SectionQuality[];
	months: QualityMonth[];
	resolutions: MixEntry[];
	codecs: MixEntry[];
	duplicateItems: number;
	duplicateWaste: number;
	h264Items: number;
	h264Bytes: number;
}

interface MonthAccumulator extends Omit<QualityMonth, 'cumulativeBytes' | 'medianBitrate'> {
	videoBitrates: number[];
}

interface SectionAccumulator {
	items: number;
	bytes: number;
	bitrates: number[];
	/** Parallel to `bitrates` after sorting — the file size of each rated item,
	 *  so a tier can report how much disk it occupies and not just how many
	 *  files it holds. */
	rated: { bitrate: number; bytes: number }[];
}

const VIDEO_TYPES = new Set(['movie', 'episode']);

function nextMonth(month: string): string {
	const year = Number(month.slice(0, 4));
	const index = Number(month.slice(5, 7));
	return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`;
}

function median(sorted: number[]): number | null {
	return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

/**
 * Everything the summary half of the page needs, from one pass.
 *
 * Bitrate percentiles are computed *within each library section* rather than
 * across the whole collection. Absolute thresholds ("under 5 Mbps is bad") are
 * wrong for anyone whose library isn't the one they were tuned on: they'd
 * condemn an entire music library and flatter a collection of 4K rips. Ranking
 * an item against its own neighbours asks the only question with a useful
 * answer — is this one of the weaker copies *you* hold?
 */
export async function getQualityOverview(
	accountId: number,
	timeZone: string,
	filters: QualityFilters = {}
): Promise<QualityOverview> {
	const rows = await db
		.select({
			serverId: libraryItems.serverId,
			sectionKey: libraryItems.sectionKey,
			type: libraryItems.type,
			addedAt: libraryItems.addedAt,
			bitrate: libraryItems.bitrate,
			fileSize: libraryItems.fileSize,
			videoCodec: libraryItems.videoCodec,
			videoResolution: libraryItems.videoResolution,
			versionCount: libraryItems.versionCount
		})
		.from(libraryItems)
		.where(scope(accountId, filters));

	const sections = new Map<string, SectionAccumulator>();
	const months = new Map<string, MonthAccumulator>();
	const resolutions = new Map<string, MixEntry>();
	const codecs = new Map<string, MixEntry>();

	let rated = 0;
	let sized = 0;
	let totalBytes = 0;
	let duplicateItems = 0;
	let duplicateWaste = 0;
	let h264Items = 0;
	let h264Bytes = 0;

	for (const row of rows) {
		const id = `${row.serverId}:${row.sectionKey}`;
		const bytes = row.fileSize ?? 0;

		let section = sections.get(id);
		if (!section) {
			section = { items: 0, bytes: 0, bitrates: [], rated: [] };
			sections.set(id, section);
		}
		section.items++;
		section.bytes += bytes;

		if (row.bitrate != null && row.bitrate > 0) {
			rated++;
			section.bitrates.push(row.bitrate);
			section.rated.push({ bitrate: row.bitrate, bytes });
		}

		if (row.fileSize != null) {
			sized++;
			totalBytes += row.fileSize;
		}

		// `fileSize` is the sum across an item's versions, so the waste is
		// everything but one version's worth. Versions are rarely the same size,
		// which is exactly why this is an estimate and labelled as one.
		if (row.versionCount > 1) {
			duplicateItems++;
			duplicateWaste += Math.round((bytes * (row.versionCount - 1)) / row.versionCount);
		}

		const group = codecGroup(row.videoCodec);
		if (group === 'h264') {
			h264Items++;
			h264Bytes += bytes;
		}

		if (row.videoResolution) {
			const key = row.videoResolution.toLowerCase();
			const entry = resolutions.get(key) ?? {
				key,
				label: RESOLUTION_LABELS[key] ?? key.toUpperCase(),
				count: 0,
				bytes: 0
			};
			entry.count++;
			entry.bytes += bytes;
			resolutions.set(key, entry);
		}

		if (row.videoCodec) {
			const key = row.videoCodec.toLowerCase();
			const entry = codecs.get(key) ?? { key, label: key.toUpperCase(), count: 0, bytes: 0 };
			entry.count++;
			entry.bytes += bytes;
			codecs.set(key, entry);
		}

		// Month buckets come from the local day key rather than SQLite's `strftime`
		// — the same reason as everywhere else in this codebase, that SQLite has no
		// IANA zones and an evening import would land in the wrong month at the
		// month boundary.
		const month = dayKeyInZone(row.addedAt, timeZone).slice(0, 7);
		let bucket = months.get(month);
		if (!bucket) {
			bucket = {
				month,
				items: 0,
				bytes: 0,
				videoItems: 0,
				videoBitrates: [],
				codecs: { hevc: 0, h264: 0, other: 0 },
				bySection: {}
			};
			months.set(month, bucket);
		}
		bucket.items++;
		bucket.bytes += bytes;
		bucket.bySection[id] = (bucket.bySection[id] ?? 0) + bytes;

		if (VIDEO_TYPES.has(row.type)) {
			bucket.videoItems++;
			if (row.bitrate != null && row.bitrate > 0) bucket.videoBitrates.push(row.bitrate);
			if (row.videoCodec) bucket.codecs[group]++;
		}
	}

	// ---- Percentile tiers, per section ----

	const tierTotals = emptyTiers();
	const tierBytes = emptyTiers();
	let unranked = 0;

	const sectionStats: SectionQuality[] = [];

	for (const [id, section] of sections) {
		const sorted = [...section.bitrates].sort((a, b) => a - b);
		const rankable = sorted.length >= MIN_RANKABLE;
		const tiers = emptyTiers();

		if (rankable) {
			const ranked = [...section.rated].sort((a, b) => a.bitrate - b.bitrate);
			const n = ranked.length;

			// Every row in a run of identical bitrates gets the *midpoint* of that
			// run's ranks. Music libraries are full of files encoded at exactly the
			// same rate, and splitting an identical-quality block across two tiers
			// would be an artefact of sort order rather than a fact about the files.
			// Taking the run's first rank instead would file a library that's
			// uniformly 320 kbps entirely into the bottom quarter of itself.
			let index = 0;
			while (index < n) {
				let end = index;
				while (end + 1 < n && ranked[end + 1].bitrate === ranked[index].bitrate) end++;

				const tier = tierFor(((index + end) / 2 / (n - 1)) * 100);
				for (let i = index; i <= end; i++) {
					tiers[tier]++;
					tierTotals[tier]++;
					tierBytes[tier] += ranked[i].bytes;
				}
				index = end + 1;
			}
		} else {
			unranked += sorted.length;
		}

		sectionStats.push({
			id,
			items: section.items,
			rated: sorted.length,
			ranked: rankable,
			bytes: section.bytes,
			tiers,
			p25: rankable ? quantile(sorted, 0.25) : null,
			p50: rankable ? quantile(sorted, 0.5) : null,
			p75: rankable ? quantile(sorted, 0.75) : null,
			p90: rankable ? quantile(sorted, 0.9) : null
		});
	}

	sectionStats.sort((a, b) => b.bytes - a.bytes || b.items - a.items);

	// ---- Months, gap-filled ----

	const ordered = [...months.keys()].sort();
	const series: QualityMonth[] = [];
	let cumulative = 0;

	if (ordered.length) {
		// Quiet months are emitted as zeroes rather than skipped: a gap in the bars
		// is the finding — a year where nothing was added — and a chart that closed
		// the gap would draw a steady trickle that never happened.
		for (let month = ordered[0]; month <= ordered.at(-1)!; month = nextMonth(month)) {
			const bucket = months.get(month);
			cumulative += bucket?.bytes ?? 0;

			series.push({
				month,
				items: bucket?.items ?? 0,
				bytes: bucket?.bytes ?? 0,
				cumulativeBytes: cumulative,
				videoItems: bucket?.videoItems ?? 0,
				medianBitrate: bucket ? median([...bucket.videoBitrates].sort((a, b) => a - b)) : null,
				codecs: bucket?.codecs ?? { hevc: 0, h264: 0, other: 0 },
				bySection: bucket?.bySection ?? {}
			});
		}
	}

	return {
		items: rows.length,
		rated,
		sized,
		totalBytes,
		tiers: TIER_KEYS.map((key) => ({ key, count: tierTotals[key], bytes: tierBytes[key] })),
		unranked,
		sections: sectionStats,
		months: series,
		resolutions: [...resolutions.values()].sort(
			(a, b) =>
				(RESOLUTION_ORDER.indexOf(a.key) + 1 || 99) - (RESOLUTION_ORDER.indexOf(b.key) + 1 || 99)
		),
		codecs: [...codecs.values()].sort((a, b) => b.count - a.count),
		duplicateItems,
		duplicateWaste,
		h264Items,
		h264Bytes
	};
}

// ---- Worklists --------------------------------------------------------------

export interface QualityItem {
	id: string;
	sectionId: string;
	title: string;
	subtitle: string | null;
	fileSize: number;
	bitrate: number | null;
	videoCodec: string | null;
	videoResolution: string | null;
	versionCount: number;
	/** Bytes we'd expect to get back. An estimate in both worklists — see the
	 *  notes on each function. */
	savingBytes: number;
}

/**
 * How much smaller the same content is assumed to be once re-encoded to HEVC.
 *
 * A deliberately conservative round number. Real results swing from ~25% on
 * grainy film scans to ~60% on clean digital sources, and the honest thing to
 * do with a spread that wide is to say so in the UI rather than to pretend a
 * two-decimal estimate means anything.
 */
const HEVC_SAVING = 0.4;

const H264_MATCH = sql`lower(${libraryItems.videoCodec}) IN ('h264', 'avc', 'avc1', 'x264')`;

function label(row: {
	type: string;
	title: string;
	grandparentTitle: string | null;
	parentIndex: number | null;
	index: number | null;
	year: number | null;
}): { title: string; subtitle: string | null } {
	if (row.type !== 'episode') {
		return { title: row.title, subtitle: row.year ? String(row.year) : null };
	}

	const code =
		row.parentIndex != null && row.index != null
			? `S${String(row.parentIndex).padStart(2, '0')}E${String(row.index).padStart(2, '0')} · `
			: '';

	return {
		title: row.grandparentTitle ?? row.title,
		subtitle: `${code}${row.title}`
	};
}

const WORKLIST_COLUMNS = {
	serverId: libraryItems.serverId,
	ratingKey: libraryItems.ratingKey,
	sectionKey: libraryItems.sectionKey,
	type: libraryItems.type,
	title: libraryItems.title,
	grandparentTitle: libraryItems.grandparentTitle,
	parentIndex: libraryItems.parentIndex,
	index: libraryItems.index,
	year: libraryItems.year,
	fileSize: libraryItems.fileSize,
	bitrate: libraryItems.bitrate,
	videoCodec: libraryItems.videoCodec,
	videoResolution: libraryItems.videoResolution,
	versionCount: libraryItems.versionCount
};

/**
 * H.264 items, biggest file first.
 *
 * Ranked by size rather than by bitrate or age because size is what you get
 * back. Re-encoding is slow enough that nobody does the whole library, so the
 * only useful ordering is the one where stopping after five rows has already
 * won most of the space.
 */
export async function getReencodeWorklist(
	accountId: number,
	filters: QualityFilters = {},
	limit = 25
): Promise<QualityItem[]> {
	const rows = await db
		.select(WORKLIST_COLUMNS)
		.from(libraryItems)
		.where(and(scope(accountId, filters), H264_MATCH, isNotNull(libraryItems.fileSize)))
		.orderBy(desc(libraryItems.fileSize))
		.limit(limit);

	return rows.map((row) => ({
		id: `${row.serverId}:${row.ratingKey}`,
		sectionId: `${row.serverId}:${row.sectionKey}`,
		...label(row),
		fileSize: row.fileSize ?? 0,
		bitrate: row.bitrate,
		videoCodec: row.videoCodec,
		videoResolution: row.videoResolution,
		versionCount: row.versionCount,
		savingBytes: Math.round((row.fileSize ?? 0) * HEVC_SAVING)
	}));
}

/**
 * Items Plex holds more than one file for, worst offender first.
 *
 * `fileSize` is the sum across versions, so the waste is modelled as all but an
 * average version — right when the copies are similar, an under-estimate when
 * one of them is a 4K remux next to a 720p leftover. It ranks the list
 * correctly either way, which is what it's for.
 */
export async function getDuplicates(
	accountId: number,
	filters: QualityFilters = {},
	limit = 25
): Promise<QualityItem[]> {
	const waste = sql<number>`(${libraryItems.fileSize} * (${libraryItems.versionCount} - 1.0)) / ${libraryItems.versionCount}`;

	const rows = await db
		.select(WORKLIST_COLUMNS)
		.from(libraryItems)
		.where(
			and(
				scope(accountId, filters),
				sql`${libraryItems.versionCount} > 1`,
				isNotNull(libraryItems.fileSize)
			)
		)
		.orderBy(desc(waste))
		.limit(limit);

	return rows.map((row) => ({
		id: `${row.serverId}:${row.ratingKey}`,
		sectionId: `${row.serverId}:${row.sectionKey}`,
		...label(row),
		fileSize: row.fileSize ?? 0,
		bitrate: row.bitrate,
		videoCodec: row.videoCodec,
		videoResolution: row.videoResolution,
		versionCount: row.versionCount,
		savingBytes: Math.round(((row.fileSize ?? 0) * (row.versionCount - 1)) / row.versionCount)
	}));
}

/* ------------------------------------------------------------------------- *
 * Fit: is a file the right size for what it is?
 * ------------------------------------------------------------------------- */

/**
 * Bitrate normalised for resolution and codec, in kbps per megapixel.
 *
 * Raw bitrate can't answer "is this overkill" on its own — 8 Mbps is generous
 * for 720p and thin for 4K. Dividing by pixel count puts every resolution on
 * one scale, and multiplying by a codec factor puts every codec on it too: HEVC
 * reaching a given quality at roughly 60% of H.264's bitrate means an HEVC file
 * has to be scored as though it were the larger H.264 file it replaces,
 * otherwise every re-encode would read as "too low".
 *
 * The factors are quality-equivalence multipliers relative to H.264. They are
 * rules of thumb, not measurements, which is why the bands around them are wide.
 */
const CODEC_EFFICIENCY: Record<string, number> = {
	av1: 2.0,
	hevc: 1.7,
	h265: 1.7,
	x265: 1.7,
	vp9: 1.5,
	h264: 1.0,
	avc: 1.0,
	avc1: 1.0,
	x264: 1.0,
	vc1: 0.8,
	mpeg4: 0.7,
	msmpeg4: 0.7,
	mpeg2video: 0.5
};

/**
 * Band edges in H.264-equivalent kbps per megapixel.
 *
 * Anchored on the widely used targets for H.264 — roughly 8–12 Mbps at 1080p,
 * 4–6 at 720p, 35–45 at 4K — which all land near 4–6 kbps per megapixel once
 * normalised, so a single pair of thresholds covers every resolution. The band
 * is deliberately wider than those targets: the aim is to catch files that are
 * obviously wrong, not to relitigate every encode.
 */
export const FIT_BANDS = { low: 2500, high: 7500 } as const;

export type FitVerdict = 'starved' | 'good' | 'overkill';

export interface FitBucket {
	verdict: FitVerdict;
	items: number;
	bytes: number;
}

export interface FitReport {
	buckets: FitBucket[];
	/** Items with enough information to judge — the denominator for the shares. */
	scored: number;
	/** Video items skipped because bitrate or dimensions were missing. */
	unscored: number;
	worst: QualityItem[];
	best: QualityItem[];
	bands: { low: number; high: number };
}

function fitOf(row: {
	bitrate: number | null;
	width: number | null;
	height: number | null;
	videoCodec: string | null;
}): { score: number; verdict: FitVerdict } | null {
	if (!row.bitrate || !row.width || !row.height) return null;

	const megapixels = (row.width * row.height) / 1_000_000;
	if (megapixels <= 0) return null;

	const efficiency = CODEC_EFFICIENCY[(row.videoCodec ?? '').toLowerCase()] ?? 1;
	const score = (row.bitrate * efficiency) / megapixels;

	return {
		score,
		verdict: score < FIT_BANDS.low ? 'starved' : score > FIT_BANDS.high ? 'overkill' : 'good'
	};
}

/**
 * Splits the library into too-small, about-right and too-large.
 *
 * Scored in JS rather than SQL because the normalisation needs a per-codec
 * lookup and a division that SQLite would have to express as a long CASE — and
 * the same rows are already being read for the worklists.
 *
 * Only video is considered. Audio has no pixel count, so the whole measure is
 * meaningless for it.
 */
export async function getFitReport(
	accountId: number,
	filters: QualityFilters = {},
	limit = 15
): Promise<FitReport> {
	const rows = await db
		.select({
			...WORKLIST_COLUMNS,
			width: libraryItems.width,
			height: libraryItems.height
		})
		.from(libraryItems)
		.where(and(scope(accountId, filters), inArray(libraryItems.type, ['movie', 'episode'])));

	const buckets: Record<FitVerdict, FitBucket> = {
		starved: { verdict: 'starved', items: 0, bytes: 0 },
		good: { verdict: 'good', items: 0, bytes: 0 },
		overkill: { verdict: 'overkill', items: 0, bytes: 0 }
	};

	let unscored = 0;
	const scored: { row: (typeof rows)[number]; score: number; verdict: FitVerdict }[] = [];

	for (const row of rows) {
		const fit = fitOf(row);
		if (!fit) {
			unscored++;
			continue;
		}
		buckets[fit.verdict].items++;
		buckets[fit.verdict].bytes += row.fileSize ?? 0;
		scored.push({ row, score: fit.score, verdict: fit.verdict });
	}

	const toItem = (entry: (typeof scored)[number]): QualityItem => {
		const { title, subtitle } = label(entry.row);
		const size = entry.row.fileSize ?? 0;
		// For an overkill file the recoverable space is what sits above the top of
		// the band; a starved file has nothing to recover, so the figure is zero
		// rather than a negative pretending to be a saving.
		const excess = Math.max(0, 1 - FIT_BANDS.high / entry.score);

		return {
			id: `${entry.row.serverId}:${entry.row.ratingKey}`,
			sectionId: `${entry.row.serverId}:${entry.row.sectionKey}`,
			title,
			subtitle,
			fileSize: size,
			bitrate: entry.row.bitrate,
			videoCodec: entry.row.videoCodec,
			videoResolution: entry.row.videoResolution,
			versionCount: entry.row.versionCount,
			savingBytes: entry.verdict === 'overkill' ? Math.round(size * excess) : 0
		};
	};

	// Worst offenders both ways: the fattest files above the band (most space to
	// win back) and the thinnest below it (worst to actually watch).
	const overkill = scored
		.filter((entry) => entry.verdict === 'overkill')
		.sort((a, b) => (b.row.fileSize ?? 0) - (a.row.fileSize ?? 0))
		.slice(0, limit)
		.map(toItem);

	const starved = scored
		.filter((entry) => entry.verdict === 'starved')
		.sort((a, b) => a.score - b.score)
		.slice(0, limit)
		.map(toItem);

	return {
		buckets: [buckets.overkill, buckets.good, buckets.starved],
		scored: scored.length,
		unscored,
		worst: overkill,
		best: starved,
		bands: { low: FIT_BANDS.low, high: FIT_BANDS.high }
	};
}
