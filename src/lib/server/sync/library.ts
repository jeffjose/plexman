/**
 * Pulls library contents into SQLite, so the additions calendar can ask "what
 * landed, and when".
 *
 * Structurally the same as the history sync — per-source watermark, ascending
 * walk, upsert — but the watermark lives per *section* rather than per server,
 * because sections are scanned independently and one slow music library
 * shouldn't hold back the movies.
 */

import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import {
	libraryItems,
	librarySections,
	servers,
	type NewLibraryItem,
	type Server,
	type Account
} from '../db/schema';
import {
	fetchLibraryPage,
	getLibrarySections,
	isSupportedSection,
	leafTypeName,
	LEAF_TYPE,
	LIBRARY_PAGE_SIZE
} from '../plex/library';
import { resolveBaseUrl, type ServerTarget } from '../plex/server';
import type { PlexLibraryEntry } from '../plex/library';

export interface SectionSyncResult {
	sectionKey: string;
	title: string;
	added: number;
	scanned: number;
	error: string | null;
}

export interface LibrarySyncResult {
	sections: SectionSyncResult[];
	added: number;
	syncedAt: number;
}

/** Items pulled from one section per sync. A first run against a large music
 *  library would otherwise hold the request open for minutes; the watermark
 *  means the next run picks up exactly where this stopped. */
const MAX_ITEMS_PER_SECTION = 40_000;

/**
 * Earliest `addedAt` worth believing.
 *
 * Same class of problem as watch history: a server whose clock was wrong during
 * a scan stamps items with nonsense. 2008 predates Plex itself, so anything
 * older is a broken clock rather than a very patient collector.
 */
const MIN_PLAUSIBLE_ADDED_AT = 1_199_145_600;
const FUTURE_TOLERANCE_SECONDS = 86_400;

/**
 * What counts as one "addition" in grouped mode.
 *
 * A movie is its own group. An episode groups to its season and a track to its
 * album, which is how these things actually arrive — you add a season or an
 * album, and Plex reports it as twenty or three hundred separate items. Falling
 * back to the item's own key keeps a stray parentless item countable rather
 * than silently merging every one of them into a single null group.
 */
function groupOf(entry: PlexLibraryEntry, leafType: string): { key: string; title: string } {
	const own = { key: entry.ratingKey ?? '', title: entry.title ?? 'Unknown' };
	if (leafType === 'movie' || !entry.parentRatingKey) return own;

	const parent = entry.parentTitle ?? 'Unknown';
	const grandparent = entry.grandparentTitle;
	return {
		key: entry.parentRatingKey,
		title: grandparent ? `${grandparent} — ${parent}` : parent
	};
}

/**
 * File characteristics for an item.
 *
 * Plex includes `Media`/`Part` in the library listing already, so this is free —
 * we were parsing and discarding it. The *first* media entry is treated as the
 * representative one (Plex orders them best-first) while `fileSize` sums every
 * part across every version, because for "what is this costing me on disk" the
 * duplicates are exactly the point.
 */
function mediaOf(entry: PlexLibraryEntry) {
	const versions = entry.Media ?? [];
	const primary = versions[0];

	let fileSize: number | null = null;
	for (const version of versions) {
		for (const part of version.Part ?? []) {
			if (typeof part.size === 'number') fileSize = (fileSize ?? 0) + part.size;
		}
	}

	return {
		bitrate: primary?.bitrate ?? null,
		width: primary?.width ?? null,
		height: primary?.height ?? null,
		videoResolution: primary?.videoResolution ?? null,
		videoCodec: primary?.videoCodec ?? null,
		audioCodec: primary?.audioCodec ?? null,
		audioChannels: primary?.audioChannels ?? null,
		container: primary?.container ?? primary?.Part?.[0]?.container ?? null,
		fileSize,
		versionCount: versions.length || 1
	};
}

function toRow(
	entry: PlexLibraryEntry,
	serverId: string,
	sectionKey: string,
	leafType: string,
	syncedAt: number
): NewLibraryItem | null {
	// Without a rating key there's nothing stable to key on, and without an
	// addedAt the item can't be placed on the calendar at all.
	if (!entry.ratingKey || !entry.addedAt) return null;

	const group = groupOf(entry, leafType);

	return {
		serverId,
		ratingKey: entry.ratingKey,
		sectionKey,
		type: entry.type ?? leafType,
		title: entry.title ?? 'Unknown',
		parentTitle: entry.parentTitle ?? null,
		grandparentTitle: entry.grandparentTitle ?? null,
		groupKey: group.key,
		groupTitle: group.title,
		index: entry.index ?? null,
		parentIndex: entry.parentIndex ?? null,
		year: entry.year ?? null,
		thumb: entry.thumb ?? null,
		grandparentThumb: entry.grandparentThumb ?? entry.parentThumb ?? null,
		duration: entry.duration ?? null,
		originallyAvailableAt: entry.originallyAvailableAt ?? null,
		addedAt: entry.addedAt,
		...mediaOf(entry),
		syncedAt
	};
}

function isPlausibleAddedAt(addedAt: number, now: number): boolean {
	return addedAt >= MIN_PLAUSIBLE_ADDED_AT && addedAt <= now + FUTURE_TOLERANCE_SECONDS;
}

async function newestAddedAt(serverId: string, sectionKey: string): Promise<number> {
	const [row] = await db
		.select({ addedAt: libraryItems.addedAt })
		.from(libraryItems)
		.where(and(eq(libraryItems.serverId, serverId), eq(libraryItems.sectionKey, sectionKey)))
		.orderBy(desc(libraryItems.addedAt))
		.limit(1);
	return row?.addedAt ?? 0;
}

async function syncSection(
	baseUrl: string,
	target: ServerTarget,
	serverId: string,
	section: { key: string; title: string; type: string },
	full: boolean
): Promise<SectionSyncResult> {
	const result: SectionSyncResult = {
		sectionKey: section.key,
		title: section.title,
		added: 0,
		scanned: 0,
		error: null
	};

	const leafType = leafTypeName(section.type);
	const syncedAt = Math.floor(Date.now() / 1000);

	try {
		// One hour of overlap, as with history: `addedAt>` is exclusive and a scan
		// can stamp several items with the same second, so an exact boundary can
		// drop them. The upsert makes re-seeing them free.
		const watermark = full ? 0 : Math.max(0, (await newestAddedAt(serverId, section.key)) - 3600);

		let start = 0;
		let total = Infinity;

		while (start < total && result.scanned < MAX_ITEMS_PER_SECTION) {
			const page = await fetchLibraryPage(baseUrl, target, {
				sectionKey: section.key,
				leafType: LEAF_TYPE[section.type],
				addedAfter: watermark > 0 ? watermark : undefined,
				start,
				size: LIBRARY_PAGE_SIZE
			});

			total = page.totalSize;
			result.scanned += page.entries.length;

			const rows: NewLibraryItem[] = [];
			for (const entry of page.entries) {
				const row = toRow(entry, serverId, section.key, leafType, syncedAt);
				if (row && isPlausibleAddedAt(row.addedAt, syncedAt)) rows.push(row);
			}

			for (let offset = 0; offset < rows.length; offset += 200) {
				const written = await db
					.insert(libraryItems)
					.values(rows.slice(offset, offset + 200))
					.onConflictDoUpdate({
						target: [libraryItems.serverId, libraryItems.ratingKey],
						// Titles and artwork can change upstream; `addedAt` must not —
						// re-syncing should correct a rename, not move an item in time.
						set: {
							title: sql`excluded.title`,
							parentTitle: sql`excluded.parent_title`,
							grandparentTitle: sql`excluded.grandparent_title`,
							groupTitle: sql`excluded.group_title`,
							thumb: sql`excluded.thumb`,
							grandparentThumb: sql`excluded.grandparent_thumb`,
							duration: sql`excluded.duration`,
							// File characteristics change when a version is replaced or
							// re-encoded, so unlike addedAt these must follow the source.
							bitrate: sql`excluded.bitrate`,
							width: sql`excluded.width`,
							height: sql`excluded.height`,
							videoResolution: sql`excluded.video_resolution`,
							videoCodec: sql`excluded.video_codec`,
							audioCodec: sql`excluded.audio_codec`,
							audioChannels: sql`excluded.audio_channels`,
							container: sql`excluded.container`,
							fileSize: sql`excluded.file_size`,
							versionCount: sql`excluded.version_count`,
							syncedAt: sql`excluded.synced_at`
						}
					})
					.returning({ ratingKey: libraryItems.ratingKey });
				result.added += written.length;
			}

			if (page.entries.length < LIBRARY_PAGE_SIZE) break;
			start += LIBRARY_PAGE_SIZE;
		}

		const [counted] = await db
			.select({ n: sql<number>`count(*)` })
			.from(libraryItems)
			.where(and(eq(libraryItems.serverId, serverId), eq(libraryItems.sectionKey, section.key)));

		await db
			.update(librarySections)
			.set({
				lastAddedAt: await newestAddedAt(serverId, section.key),
				lastSyncedAt: syncedAt,
				itemCount: Number(counted?.n ?? 0),
				updatedAt: syncedAt
			})
			.where(
				and(eq(librarySections.serverId, serverId), eq(librarySections.sectionKey, section.key))
			);
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
	}

	return result;
}

/**
 * Syncs every supported library on every owned server.
 *
 * A section that fails records its error and doesn't stop the others — a music
 * library mid-scan shouldn't cost you the movie additions.
 */
export async function syncLibrary(
	account: Account,
	clientId: string,
	{ full = false }: { full?: boolean } = {}
): Promise<LibrarySyncResult> {
	// Owned servers only, matching discovery (see sync/servers.ts). Without this
	// a friend's server that predates the owned-only rule keeps getting its
	// whole library walked on every sync — work nobody asked for, for a server
	// a fresh install would never have picked up.
	const targets: Server[] = await db
		.select()
		.from(servers)
		.where(and(eq(servers.accountId, account.id), eq(servers.owned, true)));

	const results: SectionSyncResult[] = [];
	const now = Math.floor(Date.now() / 1000);

	for (const server of targets) {
		const target: ServerTarget = {
			clientId,
			accessToken: server.accessToken,
			connections: [server.baseUrl, ...(server.connections?.split('\n') ?? [])].filter(
				(uri, index, all): uri is string => Boolean(uri) && all.indexOf(uri) === index
			)
		};

		let baseUrl: string;
		try {
			baseUrl = await resolveBaseUrl(target);
		} catch (error) {
			results.push({
				sectionKey: '-',
				title: server.name,
				added: 0,
				scanned: 0,
				error: error instanceof Error ? error.message : String(error)
			});
			continue;
		}

		const sections = (await getLibrarySections(baseUrl, target)).filter(isSupportedSection);

		for (const section of sections) {
			await db
				.insert(librarySections)
				.values({
					serverId: server.clientIdentifier,
					sectionKey: String(section.key),
					title: section.title,
					type: section.type,
					updatedAt: now
				})
				.onConflictDoUpdate({
					target: [librarySections.serverId, librarySections.sectionKey],
					set: { title: section.title, type: section.type, updatedAt: now }
				});

			results.push(
				await syncSection(
					baseUrl,
					target,
					server.clientIdentifier,
					{ key: String(section.key), title: section.title, type: section.type },
					full
				)
			);
		}
	}

	return {
		sections: results,
		added: results.reduce((sum, r) => sum + r.added, 0),
		syncedAt: Math.floor(Date.now() / 1000)
	};
}
