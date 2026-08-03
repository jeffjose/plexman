/**
 * Shows, and the episode list Plex believes each one *should* have.
 *
 * Two different sources, deliberately:
 *
 *   - the media server, for the shows a library actually holds. One call per
 *     section with `includeGuids=1` returns every show along with its
 *     `plex://show/…` identity, which is what makes the second half possible.
 *   - `metadata.provider.plex.tv`, for the canonical season/episode list —
 *     including episodes nobody has downloaded, which is the entire point.
 *
 * The metadata service is asked with the *account* token, not the server one;
 * it's a plex.tv service and the per-server access token means nothing to it.
 *
 * Why this source rather than TVDB/TMDB/TVmaze: its numbering is the numbering
 * the server's own agent used when it named the files, so a diff between the
 * two is a genuine gap rather than an artefact of two databases disagreeing
 * about whether a two-part premiere is one episode or two.
 */

import { plexFetch } from './client';
import type { PlexMediaContainer } from './types';
import type { ServerTarget } from './server';

/** Plex's numeric type for a show. The library sync asks for type 4 (episodes);
 *  this asks for the show rows those episodes hang off. */
export const SHOW_TYPE = 2;

/** Shows per request. A 568-show section came back in one page in ~340ms, so
 *  this is really just a guard against a library big enough to be paginated. */
const SHOW_PAGE_SIZE = 600;

/**
 * Children per request against the metadata service.
 *
 * Not a taste decision: plex.tv answers 400 "Invalid value provided for
 * x-plex-container-size" above somewhere between 300 and 500, unlike a media
 * server, which will hand over a whole 568-show library in one page. Nothing
 * has 200 seasons, so in practice this only pages for a long-running soap.
 */
const CHILDREN_PAGE_SIZE = 200;

const METADATA_BASE = 'https://metadata.provider.plex.tv';

export interface PlexShowEntry {
	ratingKey?: string;
	/** `plex://show/<id>` for anything Plex's own agent matched. Locally-scanned
	 *  and YouTube-agent shows carry a different scheme and can't be looked up. */
	guid?: string;
	title?: string;
	year?: number;
	thumb?: string;
	/** Episodes the server holds. */
	leafCount?: number;
	/** Seasons the server holds. */
	childCount?: number;
	addedAt?: number;
	Guid?: { id?: string }[];
}

interface PlexSeasonEntry {
	index?: number;
	guid?: string;
	title?: string;
	/** Episodes the metadata service lists for this season. Zero for a season
	 *  that has been announced but has no episodes yet. */
	leafCount?: number;
}

interface PlexEpisodeEntry {
	index?: number;
	parentIndex?: number;
	title?: string;
	/** `YYYY-MM-DD`, or absent for an episode announced without a date. */
	originallyAvailableAt?: string;
}

export interface CanonicalSeason {
	number: number;
	guidId: string;
	episodeCount: number;
}

export interface CanonicalEpisodeEntry {
	season: number;
	episode: number;
	title: string | null;
	airDate: string | null;
}

/** Credentials for the metadata service — the account token, never a server's. */
export interface MetadataTarget {
	clientId: string;
	authToken: string;
}

/**
 * The `<id>` in `plex://show/<id>`, or null for a guid that isn't one.
 *
 * A locally-scanned show (`local://…`), a YouTube-agent channel or an unmatched
 * folder has no entry in the metadata service, so there is nothing to compare
 * it against and no request worth spending on it.
 */
export function plexGuidId(
	guid: string | null | undefined,
	kind: 'show' | 'season'
): string | null {
	const prefix = `plex://${kind}/`;
	if (!guid?.startsWith(prefix)) return null;
	const id = guid.slice(prefix.length).split('?')[0];
	return id || null;
}

/** `imdb://tt…`, `tmdb://…`, `tvdb://…`, newline-joined. Not used for matching —
 *  kept so a show the metadata service can't resolve is still identifiable. */
export function externalIdsOf(entry: PlexShowEntry): string | null {
	const ids = (entry.Guid ?? []).map((g) => g.id).filter((id): id is string => Boolean(id));
	return ids.length ? ids.join('\n') : null;
}

/**
 * Every show in a section, with its external ids.
 *
 * `includeGuids=1` is what turns this from one call per show into one call per
 * section: without it the `Guid` array is omitted and each show has to be
 * fetched individually to learn its identity.
 */
export async function fetchShows(
	baseUrl: string,
	target: ServerTarget,
	sectionKey: string
): Promise<PlexShowEntry[]> {
	const shows: PlexShowEntry[] = [];
	let start = 0;

	for (;;) {
		const data = await plexFetch<PlexMediaContainer<PlexShowEntry>>(
			baseUrl,
			`library/sections/${sectionKey}/all`,
			{
				clientId: target.clientId,
				token: target.accessToken,
				timeoutMs: 60_000,
				searchParams: {
					type: SHOW_TYPE,
					includeGuids: 1,
					'X-Plex-Container-Start': start,
					'X-Plex-Container-Size': SHOW_PAGE_SIZE
				}
			}
		);

		const page = data.MediaContainer?.Metadata ?? [];
		shows.push(...page);
		if (page.length < SHOW_PAGE_SIZE) return shows;
		start += SHOW_PAGE_SIZE;
	}
}

async function fetchChildren<T>(guidId: string, target: MetadataTarget): Promise<T[]> {
	const items: T[] = [];
	let start = 0;

	for (;;) {
		const data = await plexFetch<PlexMediaContainer<T>>(
			METADATA_BASE,
			`library/metadata/${guidId}/children`,
			{
				clientId: target.clientId,
				token: target.authToken,
				timeoutMs: 20_000,
				searchParams: {
					'X-Plex-Container-Start': start,
					'X-Plex-Container-Size': CHILDREN_PAGE_SIZE
				}
			}
		);

		const page = data.MediaContainer?.Metadata ?? [];
		items.push(...page);

		const total = data.MediaContainer?.totalSize;
		if (page.length < CHILDREN_PAGE_SIZE) return items;
		if (total !== undefined && items.length >= total) return items;
		start += CHILDREN_PAGE_SIZE;
	}
}

/**
 * A show's seasons, specials excluded.
 *
 * Season 0 is Plex's bucket for specials, webisodes and recaps — things nobody
 * considers themselves to be "missing" — so it never leaves this function.
 * Seasons the service lists with no episodes yet (a renewal that has been
 * announced but not written) are dropped too: they cost a request and can only
 * ever return nothing.
 */
export async function fetchCanonicalSeasons(
	guidId: string,
	target: MetadataTarget
): Promise<CanonicalSeason[]> {
	const seasons = await fetchChildren<PlexSeasonEntry>(guidId, target);

	return seasons.flatMap((season) => {
		const id = plexGuidId(season.guid, 'season');
		if (!id || typeof season.index !== 'number' || season.index <= 0) return [];
		if (season.leafCount === 0) return [];
		return [{ number: season.index, guidId: id, episodeCount: season.leafCount ?? 0 }];
	});
}

export async function fetchCanonicalEpisodes(
	season: CanonicalSeason,
	target: MetadataTarget
): Promise<CanonicalEpisodeEntry[]> {
	const episodes = await fetchChildren<PlexEpisodeEntry>(season.guidId, target);

	return episodes.flatMap((episode) => {
		if (typeof episode.index !== 'number') return [];
		return [
			{
				// The season number comes from the season we asked for rather than the
				// episode's own `parentIndex`: they agree in practice, and trusting the
				// former keeps the rows consistent with the season we walked.
				season: season.number,
				episode: episode.index,
				title: episode.title ?? null,
				airDate: episode.originallyAvailableAt?.slice(0, 10) || null
			}
		];
	});
}
