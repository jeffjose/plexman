/**
 * Identity this app presents to Plex. `PLEX_PRODUCT` is what shows up in
 * Settings → Authorized Devices on plex.tv, so it should stay recognisable and
 * stable — changing it mid-life makes the old device entry orphaned.
 */
export const PLEX_PRODUCT = 'Plexman';
export const PLEX_VERSION = '0.1.0';
export const PLEX_PLATFORM = 'Web';
export const PLEX_DEVICE_NAME = 'Plexman';

export const PLEX_TV_API = 'https://plex.tv/api/v2/';
export const PLEX_AUTH_APP = 'https://app.plex.tv/auth';

/** Rows per page when walking server history. Plex accepts larger, but 500
 *  keeps each response small enough that a slow remote server still answers
 *  inside the request timeout. */
export const HISTORY_PAGE_SIZE = 500;
