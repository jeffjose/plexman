/**
 * Shapes shared by the unfinished view and its components.
 *
 * They live outside `$lib/server` for the same reason `$lib/activity/library.ts`
 * does: the components have to name these types, and SvelteKit won't let client
 * code import from a server module.
 */

export interface NextEpisode {
	season: number | null;
	episode: number | null;
	title: string;
	/** True when this episode sits *before* where you left off — a gap you
	 *  skipped past, not the one that comes next. */
	behind: boolean;
}

/**
 * A show with some episodes played and owned episodes still unplayed.
 *
 * "Watched" here means a history row exists for that episode. There is no
 * partial credit: we don't store `viewOffset`, so an episode is either played
 * or not, and progress is only ever meaningful at show level.
 */
export interface PartWatchedShow {
	id: string;
	serverId: string;
	sectionKey: string;
	title: string;
	year: number | null;
	thumb: string | null;
	ownedEpisodes: number;
	watchedEpisodes: number;
	lastViewedAt: number;
	/** Whole local calendar days since the last episode was played. */
	idleDays: number;
	/** Where you left off — the season and episode of the most recent play. */
	lastSeason: number | null;
	lastEpisode: number | null;
	next: NextEpisode | null;
	/** Runtime of the owned-but-unplayed episodes, ms; null when Plex reported
	 *  no durations for any of them. */
	remainingMs: number | null;
	/** Unplayed episodes that sit before the resume point. */
	skipped: number;
}

export type DeadWeightKind = 'movie' | 'show' | 'album';

/** A movie, show or album with no play recorded against any of its items. */
export interface DeadWeightItem {
	id: string;
	serverId: string;
	sectionKey: string;
	kind: DeadWeightKind;
	title: string;
	subtitle: string | null;
	year: number | null;
	thumb: string | null;
	itemCount: number;
	/** Null when Plex hasn't reported a file size for any of the items. */
	bytes: number | null;
	ms: number | null;
	/** Newest `addedAt` in the group — how long the whole thing has sat there. */
	addedAt: number;
	ageDays: number;
}

export interface DeadWeight {
	/** Ranked and capped; `totalGroups` is the true size of the set. */
	items: DeadWeightItem[];
	totalGroups: number;
	/** Leaf items — every movie, episode and track, not the groups above. */
	totalItems: number;
	totalBytes: number | null;
	totalMs: number | null;
}

export interface UnfinishedSummary {
	dropped: PartWatchedShow[];
	stale: PartWatchedShow[];
	/** Part-watched shows too recent to be either — listed nowhere, counted here
	 *  so the other two numbers can be read as a share of the whole. */
	activeShows: number;
	completedShows: number;
	deadWeight: DeadWeight;
	/** False when nothing in scope has a recorded file size, which changes what
	 *  the dead-weight ranking can honestly claim. */
	haveSizes: boolean;
	/** Oldest play we hold. Anything watched before this looks untouched to us. */
	historyFrom: number | null;
	staleAfterDays: number;
	droppedAfterDays: number;
}
