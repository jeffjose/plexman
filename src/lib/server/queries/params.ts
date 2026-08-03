/**
 * Turns query-string parameters into `ActivityFilters`.
 *
 * Shared by the page load and the timeline endpoint so that a filtered view and
 * the pages it lazily fetches can't drift apart in how they read the URL — the
 * heatmap and the timeline below it have to be describing the same set.
 */

import type { ActivityFilters } from './activity';
import type { LibraryFilters } from './library';
import { isMediaType, type MediaType } from '$lib/activity/types';
import { isCountMode, type CountMode } from '$lib/activity/library';
import { dayBounds } from '$lib/activity/dates';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The nav's server scope, as a list of client identifiers.
 *
 * Empty means "all servers". Shared by both pages so the selector keeps its
 * meaning across a navigation between them.
 */
export function parseServerScope(params: URLSearchParams): string[] {
	const ids = params
		.getAll('server')
		.flatMap((value) => value.split(','))
		.filter(Boolean);
	return [...new Set(ids)];
}

export function parseActivityFilters(params: URLSearchParams, timeZone: string): ActivityFilters {
	const filters: ActivityFilters = {};

	const types = params
		.getAll('type')
		.flatMap((value) => value.split(','))
		.filter((value): value is MediaType => isMediaType(value));
	if (types.length) filters.types = [...new Set(types)];

	const scopedServers = parseServerScope(params);
	if (scopedServers.length) filters.serverIds = scopedServers;

	const search = params.get('q');
	if (search?.trim()) filters.search = search.trim();

	// `day` is the heatmap's click target and is expressed as a local calendar
	// day; it resolves to instant bounds here so callers never have to. It wins
	// over any explicit from/to, since it's the more specific request.
	const day = params.get('day');
	if (day && DAY_KEY.test(day)) {
		const bounds = dayBounds(day, timeZone);
		filters.from = bounds.from;
		filters.to = bounds.to;
	} else {
		const from = Number(params.get('from'));
		if (Number.isFinite(from) && from > 0) filters.from = from;

		const to = Number(params.get('to'));
		if (Number.isFinite(to) && to > 0) filters.to = to;
	}

	return filters;
}

/**
 * The same treatment for the library-additions view.
 *
 * Separate from `parseActivityFilters` rather than generalised: the two views
 * filter on different columns (`viewedAt` vs `addedAt`) and by different
 * dimensions (media type vs library section), and merging them would mean a
 * union type that every caller has to narrow anyway.
 */
export function parseLibraryFilters(params: URLSearchParams, timeZone: string): LibraryFilters {
	const filters: LibraryFilters = {};

	// `server` is the nav's scope selector, shared with the Activity page so the
	// two read the same parameter and stay in step across a navigation.
	const scopedServers = parseServerScope(params);
	if (scopedServers.length) filters.serverIds = scopedServers;

	const sections = params
		.getAll('section')
		.flatMap((value) => value.split(','))
		.filter(Boolean);
	if (sections.length) filters.sections = [...new Set(sections)];

	const types = params
		.getAll('type')
		.flatMap((value) => value.split(','))
		.filter((value): value is MediaType => isMediaType(value));
	if (types.length) filters.types = [...new Set(types)];

	const search = params.get('q');
	if (search?.trim()) filters.search = search.trim();

	const day = params.get('day');
	if (day && DAY_KEY.test(day)) {
		const bounds = dayBounds(day, timeZone);
		filters.from = bounds.from;
		filters.to = bounds.to;
	}

	return filters;
}

/**
 * Defaults to `groups` — a season landing as one "+10 episodes" row is what you
 * actually did, where ten near-identical rows is just how Plex stores it. An
 * unrecognised value falls back rather than 500ing a page load.
 */
export function parseCountMode(params: URLSearchParams): CountMode {
	const mode = params.get('mode');
	return mode && isCountMode(mode) ? mode : 'groups';
}
