/**
 * Media types, as the UI thinks about them.
 *
 * Plex's `type` field is open-ended (movie, episode, track, clip, photo, …) and
 * grows between versions. Rather than break on an unfamiliar value, everything
 * outside the three types worth distinguishing collapses into `other`.
 */
export const MEDIA_TYPES = ['movie', 'episode', 'track', 'other'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export function normalizeType(raw: string | null | undefined): MediaType {
	switch (raw) {
		case 'movie':
		case 'episode':
		case 'track':
			return raw;
		default:
			return 'other';
	}
}

export function isMediaType(value: string): value is MediaType {
	return (MEDIA_TYPES as readonly string[]).includes(value);
}

export const TYPE_LABELS: Record<MediaType, string> = {
	movie: 'Movies',
	episode: 'Episodes',
	track: 'Music',
	other: 'Other'
};

/** Matches the `--type-*` custom properties defined in app.css. */
export const TYPE_COLORS: Record<MediaType, string> = {
	movie: 'var(--type-movie)',
	episode: 'var(--type-episode)',
	track: 'var(--type-track)',
	other: 'var(--type-other)'
};

/**
 * One row of the timeline.
 *
 * Lives here rather than beside the query that produces it so the components
 * can name the type without importing from `$lib/server`, which SvelteKit
 * refuses to let client code touch.
 */
export interface TimelineItem {
	serverId: string;
	historyKey: string;
	type: MediaType;
	rawType: string;
	/** Show title for episodes, film title otherwise. */
	title: string;
	/** Episode title for episodes, artist/collection otherwise. */
	subtitle: string | null;
	seasonEpisode: string | null;
	year: number | null;
	thumb: string | null;
	viewedAt: number;
	/** Milliseconds, or null when the server didn't report one. */
	duration: number | null;
}
