/**
 * Shapes returned by the Plex APIs, narrowed to the fields Plexman reads.
 *
 * Plex is loose about what it includes: fields are omitted rather than nulled,
 * and which ones appear varies by media type and by server version. Everything
 * not strictly guaranteed is optional here on purpose — the sync layer is
 * responsible for coping, not the type.
 */

export interface PlexPin {
	id: number;
	code: string;
	authToken: string | null;
	clientIdentifier: string;
	expiresAt: string;
	trusted: boolean;
}

export interface PlexUser {
	id: number;
	uuid: string;
	username: string;
	title: string;
	email: string | null;
	thumb: string | null;
}

export interface PlexConnection {
	protocol: string;
	address: string;
	port: number;
	uri: string;
	local: boolean;
	relay: boolean;
	IPv6: boolean;
}

export interface PlexResource {
	name: string;
	product: string;
	productVersion: string;
	platform: string | null;
	clientIdentifier: string;
	provides: string;
	owned: boolean;
	presence: boolean;
	publicAddressMatches: boolean;
	accessToken: string | null;
	connections: PlexConnection[] | null;
}

/** An entry from `/status/sessions/history/all` on a Plex Media Server. */
export interface PlexHistoryEntry {
	historyKey?: string;
	key?: string;
	ratingKey?: string;
	librarySectionID?: string | number;
	/** 'movie' | 'episode' | 'track' | ... — Plex adds types over time, so this
	 *  stays a string and the UI buckets unknown values as "other". */
	type?: string;
	title?: string;
	/** Season title for episodes, album for tracks. */
	parentTitle?: string;
	/** Show title for episodes, artist for tracks. */
	grandparentTitle?: string;
	index?: number;
	parentIndex?: number;
	year?: number;
	thumb?: string;
	parentThumb?: string;
	grandparentThumb?: string;
	originallyAvailableAt?: string;
	/** Unix seconds. The one field this whole app is built around. */
	viewedAt?: number;
	/** Server-local account id — NOT the plex.tv account id. See accounts.ts. */
	accountID?: number;
	deviceID?: number;
	/** Present only sometimes; history rows frequently omit it. */
	duration?: number;
	viewOffset?: number;
	grandparentKey?: string;
	parentKey?: string;
	grandparentRatingKey?: string;
	parentRatingKey?: string;
}

export interface PlexMediaContainer<T> {
	MediaContainer?: {
		size?: number;
		totalSize?: number;
		offset?: number;
		Metadata?: T[];
		Account?: PlexServerAccount[];
		Directory?: PlexLibrarySection[];
	};
}

/** From `/accounts` on a Plex Media Server. */
export interface PlexServerAccount {
	id: number;
	key?: string;
	name?: string;
	defaultAudioLanguage?: string;
	thumb?: string;
}

/** From `/library/sections` on a Plex Media Server. */
export interface PlexLibrarySection {
	key: string;
	title: string;
	type: string;
	uuid?: string;
	/**
	 * A counter, not a timestamp, whatever the name suggests — a real server
	 * reports values like 6586721 next to a `scannedAt` of 1785907675. Plex bumps
	 * it whenever the section's contents change, which makes it the cheapest
	 * possible "is there anything new here" signal: unchanged counter, no work.
	 */
	contentChangedAt?: number;
	/** Unix seconds of the last scan. Moves whether or not the scan found
	 *  anything, so it's a weaker signal than `contentChangedAt` and used only
	 *  when that's missing. */
	scannedAt?: number;
	/** Metadata-agent settings changed. Unrelated to contents. */
	updatedAt?: number;
	/** True while a scan is in flight. */
	refreshing?: boolean;
}

/**
 * An in-progress playback from `/status/sessions`.
 *
 * This is the only view of a play *while it is happening*: a history row isn't
 * written until Plex scrobbles the item, around 90% through, so anything
 * currently on screen is invisible to the history endpoint. Sessions are never
 * stored — they describe a moment, not a fact about the past.
 */
export interface PlexSession {
	sessionKey?: string;
	ratingKey?: string;
	type?: string;
	title?: string;
	parentTitle?: string;
	grandparentTitle?: string;
	index?: number;
	parentIndex?: number;
	year?: number;
	thumb?: string;
	grandparentThumb?: string;
	parentThumb?: string;
	/** Milliseconds into the item. */
	viewOffset?: number;
	duration?: number;
	User?: { id?: string; title?: string; thumb?: string };
	Player?: { title?: string; product?: string; state?: string; address?: string };
}
