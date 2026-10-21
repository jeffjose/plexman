import { getContext, setContext } from 'svelte';
import { invalidateAll } from '$app/navigation';

/**
 * Whether a sync of either kind is running in this tab.
 *
 * Module-level rather than per-instance because the two callers are different
 * objects with the same server behind them: the manual full sync lives on a
 * page, the poll lives in the layout, and a poll firing mid-full-sync would ask
 * a server that is already busy answering the expensive version of the same
 * question.
 */
let busy = false;

interface SyncResponse {
	inserted: number;
	skipped: number;
	servers: { serverName: string; error: string | null }[];
	library?: {
		added: number;
		sections: { title: string; error: string | null }[];
		error?: string;
	};
	shows?: {
		checked: number;
		missing: number;
		errors: string[];
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
		if (syncing || busy) return;
		syncing = true;
		busy = true;
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

			if (result.shows?.checked) {
				// Show checking is deliberately budgeted per sync, so saying how many
				// were looked at stops "0 missing" from reading as "nothing is missing"
				// when most shows simply weren't in this run's queue.
				parts.push(`Checked ${result.shows.checked} shows, ${result.shows.missing} missing.`);
			}
			if (result.shows?.errors.length) {
				parts.push(`${result.shows.errors.length} show lookups failed.`);
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
			busy = false;
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

interface LightSyncResponse {
	changed: boolean;
	inserted: number;
	added: number;
	sessions: LiveSession[];
	servers: { serverName: string; error: string | null }[];
	ms: number;
}

export interface LiveSession {
	serverId: string;
	serverName: string;
	key: string;
	type: string;
	title: string;
	grandparentTitle: string | null;
	parentTitle: string | null;
	index: number | null;
	parentIndex: number | null;
	thumb: string | null;
	user: string | null;
	player: string | null;
	state: string | null;
	progress: number | null;
	remainingMs: number | null;
}

/** How often the tab asks whether anything happened. Short enough that finishing
 *  an episode shows up before you've stopped looking, long enough that the
 *  request is invisible next to the page loads around it. */
const POLL_INTERVAL_MS = 90_000;

/**
 * The rate while something is actually playing.
 *
 * A progress bar that only moves every 90 seconds reads as broken, and Now
 * playing is the panel people watch. The faster rate costs nothing extra —
 * `/status/sessions` is 15ms and the rest of the light sync is already gated on
 * change — and it stops the moment the last session ends.
 */
const ACTIVE_POLL_INTERVAL_MS = 30_000;

/** How often the timer wakes to *consider* polling. Smaller than either target
 *  so switching between them takes effect promptly rather than at the end of a
 *  90-second window. */
const TICK_MS = 10_000;

/** Ceiling on the error backoff. A server that's off overnight should be checked
 *  occasionally, not every 90 seconds until morning. */
const MAX_BACKOFF_MS = 10 * 60_000;

/**
 * Polls the light sync while the tab is visible.
 *
 * Visibility-gated rather than unconditional, for two reasons: a background tab
 * that nobody is reading has no use for fresher data, and browsers throttle its
 * timers anyway, so an interval left running there fires unpredictably rather
 * than usefully. Coming back to the tab is itself a good moment to check, so
 * that triggers a poll directly if enough time has passed.
 *
 * The page is only re-run when the server says something actually changed. On a
 * quiet server that is almost every poll, and invalidating regardless would turn
 * a 300ms question into a full reload of every query on the page.
 */
export function createActivityPoll() {
	let sessions = $state<LiveSession[]>([]);
	let lastPolledAt = $state(0);

	let timer: ReturnType<typeof setInterval> | null = null;
	let backoff = 0;

	async function poll() {
		if (busy || document.visibilityState !== 'visible') return;

		busy = true;
		try {
			const response = await fetch('/api/sync/light', { method: 'POST' });
			if (!response.ok) throw new Error(await response.text());

			const result = (await response.json()) as LightSyncResponse;
			sessions = result.sessions;
			lastPolledAt = Date.now();
			backoff = 0;

			if (result.changed) await invalidateAll();
		} catch {
			// Deliberately silent. A poll is not something the user asked for, so a
			// failed one must not produce a message they have to dismiss — the manual
			// sync button is where errors belong. Backing off is the whole response.
			backoff = backoff === 0 ? POLL_INTERVAL_MS : Math.min(backoff * 2, MAX_BACKOFF_MS);
			lastPolledAt = Date.now();
		} finally {
			busy = false;
		}
	}

	/** How long to wait before the next poll: faster while someone is watching,
	 *  plus whatever the error backoff has accumulated. */
	function interval(): number {
		return (sessions.length > 0 ? ACTIVE_POLL_INTERVAL_MS : POLL_INTERVAL_MS) + backoff;
	}

	function due(): boolean {
		return Date.now() - lastPolledAt >= interval();
	}

	function onVisible() {
		if (document.visibilityState !== 'visible') return;
		if (due()) void poll();
	}

	/** Starts polling; the returned function stops it. Shaped for `$effect`. */
	function start() {
		// Once immediately, so a freshly opened page doesn't sit idle before it
		// knows anything is playing. The elapsed-time guard makes this safe to call
		// again: a poll that invalidates the page re-runs the layout's effect, and
		// without it that would loop.
		if (due()) void poll();

		timer = setInterval(() => {
			if (due()) void poll();
		}, TICK_MS);
		document.addEventListener('visibilitychange', onVisible);

		return () => {
			if (timer) clearInterval(timer);
			timer = null;
			document.removeEventListener('visibilitychange', onVisible);
		};
	}

	return {
		/** What's playing right now, refreshed on every poll. Not persisted
		 *  anywhere — sessions describe a moment, and the durable record of one
		 *  arrives later as a history row. */
		get sessions() {
			return sessions;
		},
		/** Whether a poll has answered yet. Lets a panel say "nobody is watching"
		 *  only once it actually knows, rather than asserting it while asking. */
		get polled() {
			return lastPolledAt > 0;
		},
		start,
		poll
	};
}

export type ActivityPoll = ReturnType<typeof createActivityPoll>;

/**
 * The poll is created once in the layout and read by whichever page wants it.
 *
 * Context rather than a module-level singleton because the poll's lifetime is
 * the layout's: one instance per app instance, torn down with it. A module
 * singleton would outlive the component tree and, on the server, be shared
 * between requests from different people.
 */
const POLL_KEY = Symbol('plexman.activity-poll');

export function setActivityPoll(poll: ActivityPoll): ActivityPoll {
	return setContext(POLL_KEY, poll);
}

export function getActivityPoll(): ActivityPoll | undefined {
	return getContext<ActivityPoll | undefined>(POLL_KEY);
}
