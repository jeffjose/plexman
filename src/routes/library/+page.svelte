<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Heatmap from '$lib/components/activity/Heatmap.svelte';
	import AdditionsTimeline from '$lib/components/library/AdditionsTimeline.svelte';
	import Nav from '$lib/components/Nav.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { COUNT_MODES, COUNT_MODE_LABELS, type LibraryAddition } from '$lib/activity/library';
	import { formatDayLong } from '$lib/activity/dates';
	import { createSync } from '$lib/sync.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sync = createSync();

	const selectedDay = $derived(page.url.searchParams.get('day'));
	const search = $derived(page.url.searchParams.get('q') ?? '');
	const hasFilters = $derived(Boolean(selectedDay) || Boolean(search));

	/**
	 * Section labels, qualified by server only when they'd otherwise collide.
	 *
	 * Two servers both having a library called "Movies" is the normal case, and
	 * two identical chips is unreadable. Qualifying every label instead would be
	 * noise in the far more common single-server view.
	 */
	const sectionLabels = $derived.by(() => {
		const serverNames: Record<string, string> = Object.fromEntries(
			data.servers.map((server) => [server.id, server.name])
		);
		const titleCounts: Record<string, number> = {};
		for (const section of data.sections) {
			titleCounts[section.title] = (titleCounts[section.title] ?? 0) + 1;
		}

		return Object.fromEntries(
			data.sections.map((section) => [
				section.id,
				(titleCounts[section.title] ?? 0) > 1
					? `${section.title} · ${serverNames[section.serverId] ?? 'unknown'}`
					: section.title
			])
		);
	});

	function updateUrl(mutate: (params: URLSearchParams) => void) {
		const next = new URL(page.url);
		mutate(next.searchParams);
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(next, { keepFocus: true, noScroll: true });
	}

	/**
	 * Mute or unmute a library, persistently.
	 *
	 * Goes to the server rather than the URL because it's a standing preference
	 * — noisy libraries should stay muted next time the page is opened, not for
	 * the length of one navigation.
	 */
	let pendingSection = $state<string | null>(null);

	async function toggleSection(section: {
		id: string;
		serverId: string;
		sectionKey: string;
		hidden: boolean;
	}) {
		if (pendingSection) return;
		pendingSection = section.id;

		try {
			const response = await fetch('/api/library/sections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					serverId: section.serverId,
					sectionKey: section.sectionKey,
					hidden: !section.hidden
				})
			});
			if (!response.ok) throw new Error(await response.text());
			await invalidateAll();
		} catch (error) {
			console.error(error);
		} finally {
			pendingSection = null;
		}
	}

	function setMode(mode: string) {
		updateUrl((params) => params.set('mode', mode));
	}

	function selectDay(date: string | null) {
		updateUrl((params) => {
			if (date) params.set('day', date);
			else params.delete('day');
		});
	}

	let searchInput = $derived(search);
	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			updateUrl((params) => {
				if (value.trim()) params.set('q', value.trim());
				else params.delete('q');
			});
		}, 300);
	}

	// ---- Timeline paging ----------------------------------------------------

	let extraItems = $state<LibraryAddition[]>([]);
	let cursor = $state<string | null>(null);
	let loadingMore = $state(false);

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

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const request = new URL(page.url);
		request.pathname = '/api/library';
		request.searchParams.set('cursor', cursor);

		try {
			const response = await fetch(request);
			if (!response.ok) throw new Error(`Library request failed: ${response.status}`);
			const next = (await response.json()) as {
				items: LibraryAddition[];
				nextCursor: string | null;
			};
			extraItems = [...extraItems, ...next.items];
			cursor = next.nextCursor;
		} catch (error) {
			console.error(error);
			cursor = null;
		} finally {
			loadingMore = false;
		}
	}

	const neverSynced = $derived(data.sections.length === 0);

	const stats = $derived([
		{
			label: data.mode === 'groups' ? 'Seasons & albums' : 'Items added',
			value: data.summary.total.toLocaleString(),
			hint: null
		},
		{ label: 'Days with additions', value: data.summary.activeDays.toLocaleString(), hint: null },
		{
			label: 'Typical haul',
			value: `${data.summary.medianPerActiveDay}`,
			// Median, not mean: a single 3,000-track music import would drag an
			// average so far off that it stops describing any real day.
			hint: 'median, active days'
		},
		{
			label: 'Biggest day',
			value: data.summary.busiestDay ? String(data.summary.busiestDay.count) : '—',
			hint: data.summary.busiestDay
				? formatDayLong(data.summary.busiestDay.date).replace(/^\w+, /, '')
				: null
		}
	]);
</script>

<div class="mx-auto min-h-svh w-full max-w-5xl px-4 pb-24 sm:px-6">
	<Nav
		syncing={sync.syncing}
		onsync={() => sync.run()}
		servers={data.servers}
		serverScope={data.serverScope}
		viewers={data.viewers}
		userScope={data.userScope}
	/>

	{#if sync.message}
		<p
			class="mb-4 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
			role="status"
		>
			{sync.message}
		</p>
	{/if}

	{#if neverSynced}
		<div class="rounded-xl border border-dashed p-10 text-center">
			<h2 class="font-medium">No libraries synced yet</h2>
			<p class="mx-auto mt-2 max-w-sm text-sm text-balance text-muted-foreground">
				Pull your libraries to see when things were added. The first run walks every item and can
				take a minute or two.
			</p>
			<Button class="mt-5" onclick={() => sync.run(true)} disabled={sync.syncing}>
				{sync.syncing ? 'Syncing…' : 'Sync libraries'}
			</Button>
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{#each stats as stat (stat.label)}
				<div class="rounded-xl border bg-card/50 p-4">
					<div class="text-xs text-muted-foreground">{stat.label}</div>
					<div class="tabular mt-1 text-2xl font-semibold tracking-tight">{stat.value}</div>
					{#if stat.hint}
						<div class="mt-0.5 truncate text-[11px] text-muted-foreground">{stat.hint}</div>
					{/if}
				</div>
			{/each}
		</div>

		<div class="mt-8 rounded-xl border p-4 sm:p-5">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-sm font-medium">When things were added</h2>

				<!-- Counting mode. The same data reads very differently: a 24-episode
				     season is one addition or twenty-four, and both are worth asking. -->
				<div class="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Count additions by">
					{#each COUNT_MODES as mode (mode)}
						<button
							type="button"
							onclick={() => setMode(mode)}
							aria-pressed={data.mode === mode}
							class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors {data.mode ===
							mode
								? 'bg-background shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							{COUNT_MODE_LABELS[mode]}
						</button>
					{/each}
				</div>
			</div>

			<Heatmap
				days={data.summary.days}
				timeZone={data.timeZone}
				selected={selectedDay}
				onselect={selectDay}
			/>
		</div>

		<div class="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
			{#each data.sections as section (section.id)}
				<!-- Plain checkboxes rather than filled chips: six of these sit above
				     the list permanently, and a row of solid pills competes with the
				     content for attention. -->
				<button
					type="button"
					onclick={() => toggleSection(section)}
					disabled={pendingSection === section.id}
					title={section.hidden ? `Show ${section.title}` : `Hide ${section.title}`}
					class="group flex items-center gap-2 text-xs transition-opacity disabled:opacity-50 {section.hidden
						? 'text-muted-foreground'
						: 'text-foreground'}"
					aria-pressed={!section.hidden}
				>
					<span
						class="flex size-3.5 items-center justify-center rounded-[4px] border transition-colors {section.hidden
							? 'border-input group-hover:border-foreground/40'
							: 'border-foreground bg-foreground text-background'}"
						aria-hidden="true"
					>
						{#if !section.hidden}
							<svg
								viewBox="0 0 12 12"
								class="size-2.5"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M2.5 6.5 4.75 8.75 9.5 3.5" />
							</svg>
						{/if}
					</span>
					{sectionLabels[section.id]}
					<span class="tabular text-muted-foreground">{section.itemCount.toLocaleString()}</span>
				</button>
			{/each}

			<input
				type="search"
				value={searchInput}
				oninput={onSearchInput}
				placeholder="Search titles…"
				aria-label="Search library additions"
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
		{:else if hasFilters}
			<div class="mt-4 flex justify-end">
				<Button variant="ghost" size="sm" class="h-7" onclick={() => goto(resolve('/library'))}>
					Clear filters
				</Button>
			</div>
		{/if}

		<Separator class="mt-6 mb-2" />

		{#if timelineItems.length === 0}
			<p class="py-10 text-center text-sm text-muted-foreground">Nothing matches these filters.</p>
		{:else}
			<AdditionsTimeline
				items={timelineItems}
				sectionTitles={sectionLabels}
				timeZone={data.timeZone}
				hasMore={cursor !== null}
				loading={loadingMore}
				onloadmore={loadMore}
			/>
		{/if}
	{/if}
</div>
