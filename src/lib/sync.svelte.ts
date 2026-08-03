import { invalidateAll } from '$app/navigation';

interface SyncResponse {
	inserted: number;
	skipped: number;
	servers: { serverName: string; error: string | null }[];
	library?: {
		added: number;
		sections: { title: string; error: string | null }[];
		error?: string;
	};
}

/**
 * Shared sync state for the Activity and Library pages.
 *
 * Both trigger the same endpoint and both need to reflect it in the same way,
 * so the state lives here rather than being duplicated per page. A factory
 * rather than a module-level singleton: the pages don't co-exist, and a
 * singleton would keep a stale message alive across navigation.
 */
export function createSync() {
	let syncing = $state(false);
	let message = $state<string | null>(null);

	async function run(full = false) {
		if (syncing) return;
		syncing = true;
		message = null;

		try {
			const response = await fetch(`/api/sync${full ? '?full=1' : ''}`, { method: 'POST' });
			if (!response.ok) throw new Error(await response.text());

			const result = (await response.json()) as SyncResponse;
			const parts = [`Synced ${result.inserted} watched items.`];

			if (result.skipped > 0) {
				// Worth saying out loud rather than silently dropping: these are real
				// views whose timestamp the playing device got wrong.
				parts.push(
					`Ignored ${result.skipped} with an impossible timestamp (the playing device's clock was wrong).`
				);
			}

			if (result.library) {
				parts.push(`${result.library.added} library items.`);
				const badSections = result.library.sections.filter((s) => s.error);
				if (badSections.length) {
					parts.push(`Libraries that failed: ${badSections.map((s) => s.title).join(', ')}.`);
				}
				if (result.library.error) parts.push(`Library sync failed: ${result.library.error}`);
			}

			const failed = result.servers.filter((server) => server.error);
			if (failed.length) {
				parts.push(`Couldn't reach: ${failed.map((s) => s.serverName).join(', ')}.`);
			}

			message = parts.join(' ');
			await invalidateAll();
		} catch (error) {
			message = `Sync failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			syncing = false;
		}
	}

	return {
		get syncing() {
			return syncing;
		},
		get message() {
			return message;
		},
		run
	};
}
