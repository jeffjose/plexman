/**
 * Standing per-account preferences that aren't worth a table of their own.
 *
 * The server scope lives here rather than only in the URL for the same reason
 * muted libraries do: picking a server is a statement about how you want to
 * look at your data, not a one-navigation filter. Losing it on every reload
 * made the selector feel broken.
 */

import { getSetting, setSetting } from './db/settings';

/** Sentinel the UI sends for "all servers" — distinct from an absent parameter,
 *  which means "whatever you remembered last time". */
export const ALL_SERVERS = 'all';

function scopeKey(accountId: number): string {
	return `scope_server:${accountId}`;
}

export async function getServerScope(accountId: number): Promise<string[]> {
	const stored = await getSetting(scopeKey(accountId));
	return stored ? [stored] : [];
}

export async function setServerScope(accountId: number, serverId: string | null): Promise<void> {
	await setSetting(scopeKey(accountId), serverId ?? '');
}

/** Sentinel for "everyone on the server" — same reasoning as ALL_SERVERS. */
export const ALL_USERS = 'all';

function userKey(accountId: number): string {
	return `scope_user:${accountId}`;
}

/**
 * The selected viewer, as `serverId:serverAccountId`.
 *
 * Server-local account ids are only unique within a server, so the preference
 * has to carry both halves — id 1 is a different person on every server.
 */
export async function getUserScope(accountId: number): Promise<string | null> {
	const stored = await getSetting(userKey(accountId));
	return stored || null;
}

export async function setUserScope(accountId: number, value: string | null): Promise<void> {
	await setSetting(userKey(accountId), value ?? '');
}
