/**
 * Talking to an individual Plex Media Server: picking a working address,
 * resolving which server-local account is "us", and paging watch history.
 */

import { plexFetch, PlexError } from './client';
import { HISTORY_PAGE_SIZE } from './constants';
import type {
	PlexHistoryEntry,
	PlexMediaContainer,
	PlexServerAccount,
	PlexLibrarySection
} from './types';

export interface ServerTarget {
	clientId: string;
	accessToken: string;
	/** Candidate base URLs, best-first. */
	connections: string[];
}

/**
 * Finds a connection URI that answers, trying candidates in order.
 *
 * Probes `/identity`, which is the one endpoint a PMS serves without a token —
 * so a failure here is genuinely "can't reach this address" rather than an
 * auth problem, which keeps the two error cases distinguishable. Local
 * addresses fail slowly (a LAN IP from somewhere else hangs until the socket
 * gives up), so the probe timeout is short and the loop moves on.
 */
export async function resolveBaseUrl(target: ServerTarget): Promise<string> {
	const errors: string[] = [];

	for (const uri of target.connections) {
		try {
			await plexFetch(uri, 'identity', {
				clientId: target.clientId,
				token: target.accessToken,
				timeoutMs: 5_000
			});
			return uri;
		} catch (error) {
			errors.push(`${uri}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	throw new PlexError(
		`No reachable connection for server. Tried ${target.connections.length}: ${errors.join('; ')}`,
		0,
		target.connections[0] ?? '(none)'
	);
}

export async function getServerAccounts(
	baseUrl: string,
	target: ServerTarget
): Promise<PlexServerAccount[]> {
	const data = await plexFetch<PlexMediaContainer<never>>(baseUrl, 'accounts', {
		clientId: target.clientId,
		token: target.accessToken
	});
	return data.MediaContainer?.Account ?? [];
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

/**
 * Maps a plex.tv account onto the server's own account numbering.
 *
 * These are two different id spaces. On a server you own, your own account is
 * id 1 — but the history rows for a managed/shared user carry that user's
 * server-local id instead, so we can't just assume 1. Matching on username
 * (which `/accounts` reports as `name`) is the reliable link; the plex.tv id
 * happening to appear is a fallback, and 1-if-owned a last resort.
 */
export function matchServerAccount(
	serverAccounts: PlexServerAccount[],
	plexAccountId: number,
	username: string
): number | null {
	const byName = serverAccounts.find(
		(account) => account.name && account.name.toLowerCase() === username.toLowerCase()
	);
	if (byName) return byName.id;

	const byId = serverAccounts.find((account) => account.id === plexAccountId);
	if (byId) return byId.id;

	return null;
}

export interface HistoryPageOptions {
	/** Server-local account id to filter to. Omit for every user on the server. */
	serverAccountId?: number | null;
	/** Only entries strictly newer than this unix-seconds timestamp. */
	viewedAfter?: number;
	start: number;
	size?: number;
}

export interface HistoryPage {
	entries: PlexHistoryEntry[];
	totalSize: number;
	offset: number;
}

/**
 * One page of `/status/sessions/history/all`.
 *
 * Sorted ascending by `viewedAt` rather than descending: an incremental sync
 * walks forward from a watermark, and ascending order means a page boundary
 * can't cause us to skip entries that arrive mid-walk.
 *
 * `viewedAt>` is Plex's range-filter syntax and is what makes incremental sync
 * cheap — without it every sync would page through the entire history.
 */
export async function fetchHistoryPage(
	baseUrl: string,
	target: ServerTarget,
	options: HistoryPageOptions
): Promise<HistoryPage> {
	const size = options.size ?? HISTORY_PAGE_SIZE;

	const data = await plexFetch<PlexMediaContainer<PlexHistoryEntry>>(
		baseUrl,
		'status/sessions/history/all',
		{
			clientId: target.clientId,
			token: target.accessToken,
			timeoutMs: 60_000,
			searchParams: {
				sort: 'viewedAt:asc',
				accountID: options.serverAccountId ?? undefined,
				'viewedAt>': options.viewedAfter,
				'X-Plex-Container-Start': options.start,
				'X-Plex-Container-Size': size
			}
		}
	);

	const container = data.MediaContainer;
	return {
		entries: container?.Metadata ?? [],
		// `totalSize` is only present when the response is paginated; when the
		// whole result fits in one page Plex sends `size` alone.
		totalSize: container?.totalSize ?? container?.size ?? 0,
		offset: container?.offset ?? options.start
	};
}
