<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Heatmap from '$lib/components/activity/Heatmap.svelte';
	import Timeline from '$lib/components/activity/Timeline.svelte';
	import StatsBar from '$lib/components/activity/StatsBar.svelte';
	import Nav from '$lib/components/Nav.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { MEDIA_TYPES, TYPE_LABELS, type MediaType, type TimelineItem } from '$lib/activity/types';
	import { formatDayLong } from '$lib/activity/dates';
	import { createSync } from '$lib/sync.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sync = createSync();

	/**
	 * Filters live in the URL.
	 *
	 * They're what the server load reads, so keeping them there means a filtered
	 * view is shareable, survives a reload, and can't drift out of sync with the
	 * data on screen — a local copy would have to be reconciled after every
	 * navigation.
	 */
	const activeTypes = $derived(page.url.searchParams.getAll('type') as MediaType[]);
	const selectedDay = $derived(page.url.searchParams.get('day'));
	const search = $derived(page.url.searchParams.get('q') ?? '');
	const hasFilters = $derived(activeTypes.length > 0 || Boolean(selectedDay) || Boolean(search));

	function updateUrl(mutate: (params: URLSearchParams) => void) {
		const next = new URL(page.url);
		mutate(next.searchParams);
		// Navigating to the page we're already on with different query params.
		// `resolve()` exists to turn a route id into a path, which this isn't —
		// the rule just can't tell a same-route URL object from an external one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(next, { keepFocus: true, noScroll: true });
	}

	function toggleType(type: MediaType) {
		updateUrl((params) => {
			const current = params.getAll('type');
			const next = current.includes(type)
				? current.filter((value) => value !== type)
				: [...current, type];

			params.delete('type');
			for (const value of next) params.append('type', value);
		});
	}

	/** Clicking a heatmap cell scopes the timeline to that day. The server turns
	 *  the day key into instant bounds — see `dayBounds` in queries/params.ts. */
	function selectDay(date: string | null) {
		updateUrl((params) => {
			if (date) params.set('day', date);
			else params.delete('day');
		});
	}

	// Writable derived: mirrors the URL, but the input owns it between keystrokes
	// so typing isn't fighting the 300ms debounce below.
	let searchInput = $derived(search);

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		clearTimeout(searchTimer);
		// Debounced because every keystroke re-runs the load, which re-queries the
		// whole summary.
		searchTimer = setTimeout(() => {
			updateUrl((params) => {
				if (value.trim()) params.set('q', value.trim());
				else params.delete('q');
			});
		}, 300);
	}

	// ---- Timeline paging ----------------------------------------------------

	let extraItems = $state<TimelineItem[]>([]);
	let cursor = $state<string | null>(null);
	let loadingMore = $state(false);

	// A filter change replaces the timeline wholesale, so pages accumulated under
	// the old filters have to go. Keyed on the server-provided first page.
	$effect(() => {
		const firstPage = data.timeline;
		extraItems = [];
		cursor = firstPage.nextCursor;
		loadingMore = false;
	});

	const timelineItems = $derived([...data.timeline.items, ...extraItems]);

	async function loadMore() {
		if (loadingMore || !cursor) return;
		loadingMore = true;

		// The timeline endpoint reads exactly the same filter params as the page
		// load, so the current URL is reused verbatim with a cursor added — the
		// two can't disagree about what's being listed. Plain URL, not SvelteURL:
		// it's built, fetched once and dropped, and nothing tracks it.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const request = new URL(page.url);
		request.pathname = '/api/timeline';
		request.searchParams.set('cursor', cursor);

		try {
			const response = await fetch(request);
			if (!response.ok) throw new Error(`Timeline request failed: ${response.status}`);
			const next = (await response.json()) as { items: TimelineItem[]; nextCursor: string | null };
			extraItems = [...extraItems, ...next.items];
			cursor = next.nextCursor;
		} catch (error) {
			console.error(error);
			// Drop the cursor so the observer stops retrying; the Load more button
			// disappears with it and a reload is the recovery path.
			cursor = null;
		} finally {
			loadingMore = false;
		}
	}

	const neverSynced = $derived(
		data.servers.length > 0 && data.servers.every((s) => !s.lastSyncedAt)
	);
</script>

<div class="mx-auto min-h-svh w-full max-w-5xl px-4 pb-24 sm:px-6">
	<Nav syncing={sync.syncing} onsync={() => sync.run()} servers={data.servers} />

	{#if sync.message}
		<p
			class="mb-4 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
			role="status"
		>
			{sync.message}
		</p>
	{/if}

	{#if data.servers.length === 0}
		<div class="rounded-xl border border-dashed p-10 text-center">
			<h2 class="font-medium">No Plex servers found</h2>
			<p class="mx-auto mt-2 max-w-sm text-sm text-balance text-muted-foreground">
				This account doesn't have access to any Plex Media Server, or plex.tv couldn't be reached.
				Sync to look again.
			</p>
			<Button class="mt-5" onclick={() => sync.run()} disabled={sync.syncing}>
				{sync.syncing ? 'Looking…' : 'Look again'}
			</Button>
		</div>
	{:else if data.summary.total === 0}
		<div class="rounded-xl border border-dashed p-10 text-center">
			<h2 class="font-medium">{neverSynced ? 'Nothing synced yet' : 'No activity found'}</h2>
			<p class="mx-auto mt-2 max-w-sm text-sm text-balance text-muted-foreground">
				{#if neverSynced}
					Pull your watch history from {data.servers.length === 1
						? data.servers[0].name
						: `${data.servers.length} servers`}. The first sync walks your whole history and can
					take a minute.
				{:else if hasFilters}
					Nothing matches these filters.
				{:else}
					Your servers reported no watch history for this account.
				{/if}
			</p>
			{#if hasFilters}
				<Button variant="outline" class="mt-5" onclick={() => goto(resolve('/'))}>
					Clear filters
				</Button>
			{:else}
				<Button class="mt-5" onclick={() => sync.run(true)} disabled={sync.syncing}>
					{sync.syncing ? 'Syncing…' : 'Sync history'}
				</Button>
			{/if}
		</div>
	{:else}
		<StatsBar
			total={data.summary.total}
			activeDays={data.summary.activeDays}
			currentStreak={data.summary.currentStreak}
			longestStreak={data.summary.longestStreak}
			busiestDay={data.summary.busiestDay}
			byType={data.summary.byType}
		/>

		<div class="mt-8 rounded-xl border p-4 sm:p-5">
			<Heatmap
				days={data.summary.days}
				timeZone={data.timeZone}
				selected={selectedDay}
				onselect={selectDay}
			/>
		</div>

		<div class="mt-8 flex flex-wrap items-center gap-2">
			{#each MEDIA_TYPES as type (type)}
				{@const active = activeTypes.includes(type)}
				{@const count = data.summary.byType[type]}
				<button
					type="button"
					onclick={() => toggleType(type)}
					disabled={count === 0 && !active}
					class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 {active
						? 'border-transparent bg-foreground text-background'
						: 'hover:bg-accent'}"
					aria-pressed={active}
				>
					<span
						class="size-2 rounded-full"
						style="background-color: var(--type-{type})"
						aria-hidden="true"
					></span>
					{TYPE_LABELS[type]}
					<span class="tabular opacity-60">{count.toLocaleString()}</span>
				</button>
			{/each}

			<input
				type="search"
				value={searchInput}
				oninput={onSearchInput}
				placeholder="Search titles…"
				aria-label="Search watched titles"
				class="ml-auto h-8 w-full rounded-md border border-input bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-56"
			/>
		</div>

		{#if selectedDay}
			<div class="mt-4 flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
				<span class="text-sm">
					Showing <span class="font-medium">{formatDayLong(selectedDay)}</span>
				</span>
				<Button variant="ghost" size="sm" class="ml-auto h-7" onclick={() => selectDay(null)}>
					Clear
				</Button>
			</div>
		{/if}

		<Separator class="mt-6 mb-2" />

		<Timeline
			items={timelineItems}
			timeZone={data.timeZone}
			hasMore={cursor !== null}
			loading={loadingMore}
			onloadmore={loadMore}
		/>
	{/if}
</div>
