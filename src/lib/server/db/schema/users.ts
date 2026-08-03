import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

/**
 * A user account as the *server* numbers them.
 *
 * Distinct from `accounts`, which is the plex.tv identity Plexman signs in as.
 * A media server keeps its own id space — the owner is usually 1, and everyone
 * you've shared with gets their own — and it's those ids that appear on history
 * rows. Storing them is what lets the activity views name a user instead of
 * printing a bare number.
 *
 * Only enumerable on servers you own: `/accounts` is admin-only, so a server
 * merely shared with you contributes exactly one row, yourself.
 *
 * `serverId` carries no foreign key for the same reason `shows` doesn't —
 * declaring one here would make this module and `schema.ts` a circular import.
 */
export const serverAccounts = sqliteTable(
	'server_accounts',
	{
		serverId: text('server_id').notNull(),
		/** The server-local account id, as it appears on history rows. */
		accountId: integer('account_id').notNull(),
		name: text('name'),
		thumb: text('thumb'),
		/** True for the account Plexman itself signs in as — the default view, and
		 *  the only one guaranteed to exist. */
		isSelf: integer('is_self', { mode: 'boolean' }).notNull().default(false),
		/** Rows seen in history for this user, refreshed on sync. Lets the picker
		 *  hide accounts that exist but have never watched anything. */
		historyCount: integer('history_count').notNull().default(0),
		updatedAt: integer('updated_at').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.serverId, table.accountId] }),
		index('server_accounts_server_idx').on(table.serverId)
	]
);

export type ServerAccount = typeof serverAccounts.$inferSelect;
export type NewServerAccount = typeof serverAccounts.$inferInsert;
