import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { servers } from '$lib/server/db/schema';
import { getActivitySummary, getTimeline } from '$lib/server/queries/activity';
import { parseActivityFilters } from '$lib/server/queries/params';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.account) redirect(303, '/login');

	const filters = parseActivityFilters(url.searchParams, locals.timeZone);

	// Selecting a day narrows the timeline but deliberately not the heatmap:
	// collapsing the calendar to the single day the user just clicked would
	// erase the thing they clicked on, and with it any way back.
	const summaryFilters = url.searchParams.has('day')
		? { ...filters, from: undefined, to: undefined }
		: filters;

	// The summary covers all of history (it has to — the heatmap spans years),
	// while the timeline is only the first page; the rest streams in on scroll.
	const [summary, timeline, knownServers] = await Promise.all([
		getActivitySummary(locals.account.id, locals.timeZone, summaryFilters),
		getTimeline(locals.account.id, { ...filters, limit: 60 }),
		db
			.select({
				id: servers.clientIdentifier,
				name: servers.name,
				owned: servers.owned,
				lastSyncedAt: servers.lastSyncedAt,
				lastSyncError: servers.lastSyncError
			})
			.from(servers)
			.where(eq(servers.accountId, locals.account.id))
	]);

	return { summary, timeline, servers: knownServers, filters };
};
