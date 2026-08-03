export const TIMEZONE_COOKIE = 'plexman_tz';

/**
 * Rejects anything that isn't a zone this runtime recognises.
 *
 * The value arrives from a client-set cookie, so it's untrusted input that ends
 * up in `Intl.DateTimeFormat`; validating here keeps a bad value from throwing
 * deep inside the bucketing loop.
 */
export function isValidTimeZone(value: string | undefined): value is string {
	if (!value || value.length > 64) return false;
	try {
		new Intl.DateTimeFormat('en-CA', { timeZone: value });
		return true;
	} catch {
		return false;
	}
}
