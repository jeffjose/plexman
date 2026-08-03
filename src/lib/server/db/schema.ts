import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * Small server-side key/value store. Currently holds only the Plex client
 * identifier, which must survive restarts (see plex/auth.ts) and doesn't
 * deserve a table of its own.
 */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: integer('updated_at').notNull()
});

/**
 * A signed-in Plex account.
 *
 * `id` is plex.tv's numeric account id. The auth token is stored here rather
 * than in the session cookie so it never reaches the browser, and so a
 * background sync can run without a live request to borrow a token from.
 */
export const accounts = sqliteTable('accounts', {
	id: integer('id').primaryKey(),
	uuid: text('uuid').notNull(),
	username: text('username').notNull(),
	title: text('title').notNull(),
	email: text('email'),
	thumb: text('thumb'),
	authToken: text('auth_token').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

/**
 * Browser sessions. The cookie carries only this random id; everything
 * sensitive hangs off the account row.
 */
export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		accountId: integer('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at').notNull(),
		expiresAt: integer('expires_at').notNull()
	},
	(table) => [index('sessions_account_idx').on(table.accountId)]
);

/**
 * A Plex Media Server this account can reach.
 *
 * `accessToken` is the per-server token from the resources call, which is not
 * interchangeable with the account token. `baseUrl` is the connection URI that
 * most recently answered — cached so we don't re-probe every candidate address
 * on each sync, and refreshed when it stops working.
 */
export const servers = sqliteTable(
	'servers',
	{
		clientIdentifier: text('client_identifier').primaryKey(),
		accountId: integer('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		product: text('product'),
		version: text('version'),
		owned: integer('owned', { mode: 'boolean' }).notNull().default(false),
		accessToken: text('access_token').notNull(),
		baseUrl: text('base_url'),
		/** All candidate URIs, newline-joined, best-first. Probed in order when
		 *  `baseUrl` fails. */
		connections: text('connections'),
		/** The server-local account id matching this Plex account, resolved from
		 *  /accounts. Null until the first sync works it out. */
		serverAccountId: integer('server_account_id'),
		lastSyncedAt: integer('last_synced_at'),
		lastSyncError: text('last_sync_error'),
		updatedAt: integer('updated_at').notNull()
	},
	(table) => [index('servers_account_idx').on(table.accountId)]
);

/**
 * One watched item, as reported by a server's history endpoint.
 *
 * The primary key is (server, historyKey) because history keys are only unique
 * within a server. Where a server omits `historyKey` — some older versions do —
 * the sync layer synthesises a stable one from ratingKey + viewedAt, which is
 * also what makes re-syncing the same window idempotent.
 *
 * Titles are denormalised rather than joined to a media table: history is
 * append-only and a row records what was watched *then*, so a later rename
 * upstream shouldn't rewrite the past.
 */
export const history = sqliteTable(
	'history',
	{
		serverId: text('server_id')
			.notNull()
			.references(() => servers.clientIdentifier, { onDelete: 'cascade' }),
		historyKey: text('history_key').notNull(),
		accountId: integer('account_id').notNull(),
		/** Server-local account id from the history row, kept for multi-user
		 *  servers where we may later want to show who watched what. */
		serverAccountId: integer('server_account_id'),
		ratingKey: text('rating_key'),
		librarySectionId: text('library_section_id'),
		type: text('type').notNull().default('other'),
		title: text('title').notNull().default('Unknown'),
		parentTitle: text('parent_title'),
		grandparentTitle: text('grandparent_title'),
		/** Episode number for episodes, track number for tracks. */
		index: integer('index'),
		/** Season number for episodes, disc for tracks. */
		parentIndex: integer('parent_index'),
		year: integer('year'),
		thumb: text('thumb'),
		grandparentThumb: text('grandparent_thumb'),
		/** Milliseconds. Frequently absent from history rows — treat null as
		 *  unknown, not zero, when summing watch time. */
		duration: integer('duration'),
		originallyAvailableAt: text('originally_available_at'),
		/** Unix seconds, UTC. Local-day bucketing happens at render time. */
		viewedAt: integer('viewed_at').notNull(),
		deviceId: integer('device_id'),
		syncedAt: integer('synced_at').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.serverId, table.historyKey] }),
		index('history_account_viewed_idx').on(table.accountId, table.viewedAt),
		index('history_viewed_idx').on(table.viewedAt),
		index('history_type_idx').on(table.type)
	]
);

/**
 * A library on a server — "Movies", "TV Shows", "Music".
 *
 * Kept as its own table so the additions view can offer per-library filters
 * with real titles without joining through every item row.
 */
export const librarySections = sqliteTable(
	'library_sections',
	{
		serverId: text('server_id')
			.notNull()
			.references(() => servers.clientIdentifier, { onDelete: 'cascade' }),
		/** Plex's section key, unique per server but not globally. */
		sectionKey: text('section_key').notNull(),
		title: text('title').notNull(),
		/** 'movie' | 'show' | 'artist' | 'photo' — the section kind, which decides
		 *  which leaf type gets walked. */
		type: text('type').notNull(),
		/**
		 * Muted from the additions view.
		 *
		 * Stored server-side rather than in the URL or localStorage because it's a
		 * standing preference — "YouTube is noise, stop showing it" should hold the
		 * next time the page is opened, from any browser. Items stay synced; only
		 * the presentation is filtered, so unmuting is instant and lossless.
		 */
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		/** Newest `addedAt` already stored, the incremental sync watermark. */
		lastAddedAt: integer('last_added_at'),
		lastSyncedAt: integer('last_synced_at'),
		itemCount: integer('item_count').notNull().default(0),
		updatedAt: integer('updated_at').notNull()
	},
	(table) => [primaryKey({ columns: [table.serverId, table.sectionKey] })]
);

/**
 * A leaf item in a library, recorded for when it was *added*.
 *
 * Deliberately stored at leaf grain — individual movies, episodes and tracks —
 * because grouping can always be derived upward but never recovered downward.
 * `groupKey` is the pre-computed rollup so the grouped view is a `count
 * (distinct …)` rather than a join.
 *
 * Unlike `history`, this table mirrors the library's *current* state: an item
 * deleted in Plex simply stops being returned, so a full re-sync is what
 * reconciles removals.
 */
export const libraryItems = sqliteTable(
	'library_items',
	{
		serverId: text('server_id')
			.notNull()
			.references(() => servers.clientIdentifier, { onDelete: 'cascade' }),
		/** Plex's rating key — unique per server, stable across renames. */
		ratingKey: text('rating_key').notNull(),
		sectionKey: text('section_key').notNull(),
		/** 'movie' | 'episode' | 'track'. */
		type: text('type').notNull(),
		title: text('title').notNull().default('Unknown'),
		/** Season title for episodes, album for tracks. */
		parentTitle: text('parent_title'),
		/** Show title for episodes, artist for tracks. */
		grandparentTitle: text('grandparent_title'),
		/**
		 * What one "addition" means in grouped mode: the movie itself, the season
		 * an episode belongs to, or the album/audiobook a track belongs to.
		 * Pre-computed at sync so the query is a plain distinct-count.
		 */
		groupKey: text('group_key').notNull(),
		/** Human-readable label for `groupKey`. */
		groupTitle: text('group_title').notNull().default('Unknown'),
		index: integer('index'),
		parentIndex: integer('parent_index'),
		year: integer('year'),
		thumb: text('thumb'),
		grandparentThumb: text('grandparent_thumb'),
		/** Milliseconds. */
		duration: integer('duration'),
		originallyAvailableAt: text('originally_available_at'),
		/** Unix seconds, UTC. The field this whole view is built around. */
		addedAt: integer('added_at').notNull(),
		syncedAt: integer('synced_at').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.serverId, table.ratingKey] }),
		index('library_added_idx').on(table.addedAt),
		index('library_section_added_idx').on(table.serverId, table.sectionKey, table.addedAt),
		index('library_group_idx').on(table.serverId, table.groupKey)
	]
);

export type Account = typeof accounts.$inferSelect;
export type LibrarySection = typeof librarySections.$inferSelect;
export type LibraryItem = typeof libraryItems.$inferSelect;
export type NewLibraryItem = typeof libraryItems.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type HistoryRow = typeof history.$inferSelect;
export type NewHistoryRow = typeof history.$inferInsert;
