import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * A TV show as it exists in a library, plus the identity needed to look it up
 * against Plex's metadata service.
 *
 * Separate from `library_items` because that table stores *leaves* — episodes —
 * and a show is the thing you ask "am I missing anything?" about. `leafCount`
 * is what the server says it holds, which is cheaper to compare against than
 * counting our own rows.
 */
export const shows = sqliteTable(
	'shows',
	{
		serverId: text('server_id').notNull(),
		ratingKey: text('rating_key').notNull(),
		sectionKey: text('section_key').notNull(),
		/**
		 * Plex's own identifier, e.g. `plex://show/5d9c086eba6eb9001fba3d37`.
		 *
		 * This is the one that matters: it addresses Plex's metadata service, whose
		 * episode numbering is by construction the same numbering the server used
		 * to name your files. Third-party ids invite off-by-one mismatches.
		 */
		guid: text('guid'),
		/** Newline-joined `imdb://…`, `tmdb://…`, `tvdb://…` — kept for future use
		 *  and for debugging a show the metadata service can't resolve. */
		externalIds: text('external_ids'),
		title: text('title').notNull(),
		year: integer('year'),
		thumb: text('thumb'),
		/** Episodes the server holds, per Plex. */
		leafCount: integer('leaf_count'),
		/** Seasons the server holds. */
		childCount: integer('child_count'),
		addedAt: integer('added_at'),
		/** Newest `addedAt` among this show's episodes — the cheap "is this show
		 *  still being fed?" signal that decides which shows are worth checking. */
		lastEpisodeAddedAt: integer('last_episode_added_at'),
		/** When the canonical episode list was last refreshed. */
		checkedAt: integer('checked_at'),
		checkError: text('check_error'),
		syncedAt: integer('synced_at').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.serverId, table.ratingKey] }),
		index('shows_section_idx').on(table.serverId, table.sectionKey),
		index('shows_checked_idx').on(table.checkedAt)
	]
);

/**
 * The episode list Plex's metadata service believes exists for a show —
 * including episodes you don't own, which is the entire point.
 *
 * Keyed on the show's Plex guid rather than a per-server rating key so two
 * servers holding the same show share one canonical list.
 */
export const canonicalEpisodes = sqliteTable(
	'canonical_episodes',
	{
		showGuid: text('show_guid').notNull(),
		season: integer('season').notNull(),
		episode: integer('episode').notNull(),
		title: text('title'),
		/** `YYYY-MM-DD`. Null for episodes announced without a date. */
		airDate: text('air_date'),
		fetchedAt: integer('fetched_at').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.showGuid, table.season, table.episode] }),
		index('canonical_air_idx').on(table.airDate)
	]
);

export type Show = typeof shows.$inferSelect;
export type NewShow = typeof shows.$inferInsert;
export type CanonicalEpisode = typeof canonicalEpisodes.$inferSelect;
export type NewCanonicalEpisode = typeof canonicalEpisodes.$inferInsert;
