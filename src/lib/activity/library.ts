import type { MediaType } from './types';

/**
 * How the additions view counts.
 *
 * `items` is literal — every movie, episode and track is one. `groups` rolls
 * episodes up to their season and tracks to their album, which is how additions
 * actually happen: you add a season, and Plex reports twenty items.
 */
export type CountMode = 'items' | 'groups';

export const COUNT_MODES: CountMode[] = ['items', 'groups'];

export function isCountMode(value: string): value is CountMode {
	return value === 'items' || value === 'groups';
}

export const COUNT_MODE_LABELS: Record<CountMode, string> = {
	items: 'Every item',
	groups: 'Seasons & albums'
};

/**
 * One row of the additions timeline.
 *
 * `itemCount` is always 1 in `items` mode; in `groups` mode it's how many
 * things that group brought in on that day.
 */
export interface LibraryAddition {
	id: string;
	serverId: string;
	sectionKey: string;
	type: MediaType;
	title: string;
	subtitle: string | null;
	itemCount: number;
	/**
	 * Which episodes/tracks arrived, e.g. `E03–E06`.
	 *
	 * Matters because a grouped row is one season *on one day*, not a whole
	 * season — four episodes on Wednesday and two more on Friday are two rows,
	 * and this is what says so at a glance.
	 */
	range: string | null;
	year: number | null;
	thumb: string | null;
	addedAt: number;
}
