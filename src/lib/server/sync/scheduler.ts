/**
 * Keeps the database current when no browser is.
 *
 * The tab poll covers the case where someone is looking. This covers the rest of
 * the day: you watch something on the TV, nobody opens the app for a week, and
 * the history is already there when they do. It runs the same light sync, just
 * far less often — nothing is waiting on the answer, so there's no reason to ask
 * at the pace a visible page does.
 *
 * Two things this deliberately isn't:
 *
 *   - A full sync. Shows, deletions and the implausible-timestamp purge are
 *     reconciliation, and reconciliation that runs unattended on a timer is how
 *     a self-hosted app ends up hammering plex.tv forever. That stays on the
 *     button.
 *   - A queue. One interval, one account at a time, skipped entirely if the
 *     previous run hasn't finished. A backlog of syncs is worse than a missed
 *     one, because the data they'd fetch is identical.
 */

import { db } from '../db';
import { accounts, type Account } from '../db/schema';
import { getClientId } from '../plex/auth';
import { lightSync } from './light';

/** Slow on purpose. The tab poll is what makes the app feel live; this only has
 *  to make sure nothing is *lost* while nobody's watching. */
const INTERVAL_MS = 10 * 60_000;

/**
 * Registered on `globalThis` rather than in a module variable.
 *
 * Vite reloads server modules on edit in dev, and a plain module-level flag is
 * reset by that — every save would leave another interval running against Plex,
 * with no handle left to stop the old ones.
 */
const KEY = Symbol.for('plexman.scheduler');

interface SchedulerState {
	timer: ReturnType<typeof setInterval>;
	running: boolean;
}

const store = globalThis as unknown as Record<symbol, SchedulerState | undefined>;

async function tick(): Promise<void> {
	const state = store[KEY];
	// A run that overlaps the previous one would ask the same server the same
	// question twice; if a sync is taking longer than the interval, the right
	// answer is to skip, not to pile up.
	if (!state || state.running) return;
	state.running = true;

	try {
		const clientId = await getClientId();
		const known: Account[] = await db.select().from(accounts);

		for (const account of known) {
			try {
				const result = await lightSync(account, clientId);
				if (result.changed) {
					console.log(
						`[plexman] background sync: ${result.inserted} watched, ${result.added} library, ${result.ms}ms`
					);
				}
			} catch (error) {
				// One account's broken server must not stop the others, and must not
				// take the interval down with it.
				console.error(`[plexman] background sync failed for ${account.username}:`, error);
			}
		}
	} catch (error) {
		console.error('[plexman] background sync failed:', error);
	} finally {
		state.running = false;
	}
}

/**
 * Starts the background sync, once per process.
 *
 * `unref` matters: without it the interval is a live handle and a `pnpm build`
 * or a one-shot script that imports the server hooks would never exit.
 */
export function startScheduler(): void {
	if (store[KEY]) return;

	const timer = setInterval(() => void tick(), INTERVAL_MS);
	timer.unref?.();
	store[KEY] = { timer, running: false };

	console.log(`[plexman] background sync every ${Math.round(INTERVAL_MS / 60_000)} min`);
}
