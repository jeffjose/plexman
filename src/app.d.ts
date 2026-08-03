// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Account } from '$lib/server/db/schema';

declare global {
	namespace App {
		interface Locals {
			/** The signed-in Plex account, or null. Resolved in hooks.server.ts. */
			account: Account | null;
			/** IANA zone used to bucket history into local days. Comes from a cookie
			 *  the client sets on first paint; falls back to the server's zone. */
			timeZone: string;
			/** Servers the current view is limited to; empty means all of them.
			 *  Resolved once in hooks so every page and endpoint agrees, and
			 *  remembered across sessions. */
			serverScope: string[];
		}
	}
}

export {};
