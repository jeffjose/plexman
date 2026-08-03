import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getClientId } from '$lib/server/plex/auth';
import { syncServers } from '$lib/server/sync/servers';
import { syncHistory } from '$lib/server/sync/history';
import { syncLibrary } from '$lib/server/sync/library';
import { syncShows } from '$lib/server/sync/shows';

/**
 * Pulls fresh watch history and library contents from every owned server.
 *
 * `?full=1` ignores the watermarks and re-walks everything — needed after Plex
 * rewrites history (a library move, a "mark unwatched" sweep) and to reconcile
 * library *removals*, which an incremental walk by definition can't see.
 */
export const POST: RequestHandler = async ({ locals, url }) => {
	if (!locals.account) error(401, 'Not signed in');

	const clientId = await getClientId();
	const full = url.searchParams.get('full') === '1';

	// Refresh the server list first: tokens rotate and addresses change, and a
	// sync against a stale entry fails in a way that looks like a server outage.
	try {
		await syncServers(clientId, locals.account.id, locals.account.authToken);
	} catch (err) {
		console.error('[plexman] server refresh failed:', err);
	}

	const history = await syncHistory(locals.account, clientId, { full });

	// Library sync is the slow half — tens of thousands of items on a first run
	// — so it goes last, and a failure there still leaves fresh history behind.
	let library;
	try {
		library = await syncLibrary(locals.account, clientId, { full });
	} catch (err) {
		console.error('[plexman] library sync failed:', err);
		library = {
			sections: [],
			added: 0,
			syncedAt: Math.floor(Date.now() / 1000),
			error: err instanceof Error ? err.message : String(err)
		};
	}

	// Shows + their canonical episode lists, for missing-episode detection. Last
	// because it reaches out to plex.tv's metadata service and is the most likely
	// to be slow or rate-limited; a failure here must not cost the caller the
	// history and library data already gathered above.
	let shows;
	try {
		shows = await syncShows(locals.account, clientId, { full });
	} catch (err) {
		console.error('[plexman] show sync failed:', err);
		shows = {
			checked: 0,
			missing: 0,
			errors: [err instanceof Error ? err.message : String(err)]
		};
	}

	return json({ ...history, library, shows });
};
