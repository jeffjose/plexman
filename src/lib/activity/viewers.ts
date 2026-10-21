/**
 * Identifying a viewer at a glance.
 *
 * A real server reports no avatars — `/accounts` returns an empty `thumb` for
 * every user, owner included — so a picture isn't available to identify people
 * with. What's left is a name, too long to repeat on every row of a timeline,
 * and a colour, which isn't.
 */

/**
 * Eight hues, assigned in fixed order, never generated.
 *
 * The first attempt hashed straight to an OKLCH hue angle, which is uniform in
 * theory and was useless in practice: the five most active users on the test
 * server landed on hues 60, 77, 87, 93 and 106 — every badge on screen some
 * shade of yellow-olive, because the people you actually see are a handful of
 * samples, not a distribution. A fixed palette can't cluster that way.
 *
 * These are the dark steps of a validated categorical palette, checked against
 * this app's surface rather than assumed: all eight sit in the L 0.48–0.67 band,
 * clear 3:1 contrast on the dark background, and hold a worst adjacent CVD ΔE of
 * 8.4 — above the 8.0 target, so they stay distinguishable to colourblind
 * readers. The app is dark-only (see `app.css`), so only the dark steps exist
 * here; a light theme would need its own steps, not these lightened.
 *
 * `ink` is the label colour, picked per slot by contrast rather than fixed: near
 * black clears 4.5:1 on seven of the eight, but green is 3.98:1 against it and
 * 4.95:1 against white, so green alone flips.
 */
const SLOTS = [
	{ background: '#3987e5', ink: '#0b0b0b' }, // blue
	{ background: '#d95926', ink: '#0b0b0b' }, // orange
	{ background: '#199e70', ink: '#0b0b0b' }, // aqua
	{ background: '#c98500', ink: '#0b0b0b' }, // yellow
	{ background: '#d55181', ink: '#0b0b0b' }, // magenta
	{ background: '#008300', ink: '#ffffff' }, // green
	{ background: '#9085e9', ink: '#0b0b0b' }, // violet
	{ background: '#e66767', ink: '#0b0b0b' } // red
];

/** FNV-1a, for a stable spread from a short string. Any cheap avalanche would
 *  do; the requirement is determinism, not cryptographic anything. */
function hash(key: string): number {
	let value = 2_166_136_261;
	for (let index = 0; index < key.length; index++) {
		value ^= key.charCodeAt(index);
		value = Math.imul(value, 16_777_619);
	}
	return value >>> 0;
}

/**
 * The badge colours for a viewer, keyed on their name.
 *
 * Name rather than account id, deliberately. A live session reports the plex.tv
 * user title while a history row carries the server-local account id, so keying
 * on the id would paint the same person two different colours depending on which
 * panel you were looking at. The name is the one identifier both sides agree on,
 * and it's what a person recognises themselves by.
 *
 * With more people than slots two viewers will share a colour — unavoidable
 * past eight, and why the badge always carries initials and the row its name.
 * Colour narrows the field; the letters settle it.
 */
export function viewerColors(name: string): { background: string; ink: string } {
	return SLOTS[hash(name.trim().toLowerCase()) % SLOTS.length];
}

/**
 * One or two letters for the badge.
 *
 * A two-word name gives its initials — "Debanshu Singh" reads as DS — while a
 * single handle gives its first two characters, because one letter collides far
 * too often across a dozen users on a shared server.
 */
export function viewerInitials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return '?';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
