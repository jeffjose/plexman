/**
 * Reading library contents from a Plex Media Server.
 *
 * The interesting field is `addedAt` — when an item landed in the library,
 * which is what the additions calendar is built on. Note it is genuinely the
 * import time, not the release date; `originallyAvailableAt` is the latter.
 */

import { plexFetch } from './client';
import type { PlexMediaContainer, PlexLibrarySection } from './types';
import type { ServerTarget } from './server';

/** Rows per request when walking a library. Sections run to tens of thousands
 *  of items, and a larger page mostly buys a bigger JSON parse. */
export const LIBRARY_PAGE_SIZE = 500;

/**
 * Plex's numeric type for the *leaf* of each kind of section.
 *
 * Asking a show section for type 4 returns episodes rather than shows, which is
 * what we want: an addition is a thing that arrived, and shows arrive one
 * episode at a time. Photo sections are omitted — they're not something this
 * tool has anything useful to say about yet.
 */
export const LEAF_TYPE: Record<string, number> = {
	movie: 1,
	show: 4,
	artist: 10
};

export function isSupportedSection(section: PlexLibrarySection): boolean {
	return section.type in LEAF_TYPE;
}

/** Plex's leaf numeric type back to the string the app stores. */
const LEAF_NAME: Record<number, string> = {
	1: 'movie',
	4: 'episode',
	10: 'track'
};

export function leafTypeName(sectionType: string): string {
	return LEAF_NAME[LEAF_TYPE[sectionType]] ?? 'other';
}

export interface PlexLibraryEntry {
	ratingKey?: string;
	key?: string;
	type?: string;
	title?: string;
	parentTitle?: string;
	grandparentTitle?: string;
	parentRatingKey?: string;
	grandparentRatingKey?: string;
	index?: number;
	parentIndex?: number;
	year?: number;
	thumb?: string;
	parentThumb?: string;
	grandparentThumb?: string;
	duration?: number;
	originallyAvailableAt?: string;
	/** Unix seconds. */
	addedAt?: number;
	updatedAt?: number;
}

export async function getLibrarySections(
	baseUrl: string,
	target: ServerTarget
): Promise<PlexLibrarySection[]> {
	const data = await plexFetch<PlexMediaContainer<never>>(baseUrl, 'library/sections', {
		clientId: target.clientId,
		token: target.accessToken
	});
	return data.MediaContainer?.Directory ?? [];
}

export interface LibraryPageOptions {
	sectionKey: string;
	leafType: number;
	/** Only items added strictly after this unix-seconds timestamp. */
	addedAfter?: number;
	start: number;
	size?: number;
}

export interface LibraryPage {
	entries: PlexLibraryEntry[];
	totalSize: number;
}

/**
 * One page of a library section's leaf items.
 *
 * Ascending by `addedAt` for the same reason history is: an incremental sync
 * walks forward from a watermark, and ascending order means an item added
 * mid-walk lands after the cursor rather than shifting rows under it.
 *
 * Payload is roughly 2.2 KB per item and none of the usual trimming parameters
 * (`includeGuids=0`, `excludeAllLeaves=1`) changed the response by a single
 * byte when measured against a real server, so they aren't sent.
 */
export async function fetchLibraryPage(
	baseUrl: string,
	target: ServerTarget,
	options: LibraryPageOptions
): Promise<LibraryPage> {
	const size = options.size ?? LIBRARY_PAGE_SIZE;

	const data = await plexFetch<PlexMediaContainer<PlexLibraryEntry>>(
		baseUrl,
		`library/sections/${options.sectionKey}/all`,
		{
			clientId: target.clientId,
			token: target.accessToken,
			timeoutMs: 90_000,
			searchParams: {
				type: options.leafType,
				sort: 'addedAt:asc',
				'addedAt>': options.addedAfter,
				'X-Plex-Container-Start': options.start,
				'X-Plex-Container-Size': size
			}
		}
	);

	const container = data.MediaContainer;
	return {
		entries: container?.Metadata ?? [],
		totalSize: container?.totalSize ?? container?.size ?? 0
	};
}
