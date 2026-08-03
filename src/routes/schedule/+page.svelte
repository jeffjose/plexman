<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Nav from '$lib/components/Nav.svelte';
	import EpisodeList from '$lib/components/schedule/EpisodeList.svelte';
	import ShowRollup from '$lib/components/schedule/ShowRollup.svelte';
	import StatusMark from '$lib/components/schedule/StatusMark.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { createSync } from '$lib/sync.svelte';
	import type { ScheduleFilter } from '$lib/server/queries/schedule';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sync = createSync();

	const FILTERS: { value: ScheduleFilter; label: string }[] = [
		{ value: 'all', label: 'Everything' },
		{ value: 'missing', label: 'Missing' },
		{ value: 'holes', label: 'Gaps' },
		{ value: 'upcoming', label: 'Upcoming' }
	];

	function setParam(key: string, value: string | null) {
		const next = new URL(page.url);
		if (value === null) next.searchParams.delete(key);
		else next.searchParams.set(key, value);
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(next, { keepFocus: true, noScroll: true });
	}

	/**
	 * Filtering happens here rather than in the query.
	 *
	 * The counts above the list have to describe the same set the filters cut
	 * from, so the server returns the whole schedule once and the client narrows
	 * it — otherwise every filter would need its own count query and they could
	 * drift apart.
	 */
	const visible = $derived.by(() => {
		const all = data.report.episodes;
		switch (data.filter) {
			case 'missing':
				return all.filter((episode) => episode.status === 'missing');
			case 'holes':
				return all.filter((episode) => episode.gap === 'hole');
			case 'upcoming':
				return all.filter((episode) => episode.status === 'upcoming');
			default:
				return all;
		}
	});

	// The list is long and the interesting rows are rarely at the very top, so
	// it's capped with an explicit count rather than paged.
	const LIMIT = 300;
	const shown = $derived(visible.slice(0, LIMIT));

	const selectedShow = $derived(data.showRatingKey);
	const counts = $derived(data.report.counts);
	const coverage = $derived(data.report.coverage);
	const neverChecked = $derived(coverage.checked === 0);

	const stats = $derived([
		{ label: 'On the server', value: counts.held.toLocaleString(), tone: 'held' },
		{ label: 'Missing', value: counts.missing.toLocaleString(), tone: 'plain' },
		{ label: 'Gaps inside seasons', value: counts.holes.toLocaleString(), tone: 'hole' },
		{ label: 'Airing this week', value: counts.upcoming.toLocaleString(), tone: 'plain' }
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

	{#if neverChecked}
		<div class="rounded-xl border border-dashed p-10 text-center">
			<h2 class="font-medium">No shows checked yet</h2>
			<p class="mx-auto mt-2 max-w-md text-sm text-balance text-muted-foreground">
				Plexman compares each show against Plex's own episode list to work out what aired and what
				you have. {coverage.identified.toLocaleString()} shows are ready to check; a sync works through
				them a batch at a time, newest-airing first.
			</p>
			<Button class="mt-5" onclick={() => sync.run(true)} disabled={sync.syncing}>
				{sync.syncing ? 'Checking…' : 'Check shows'}
			</Button>
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{#each stats as stat (stat.label)}
				<div class="rounded-xl border bg-card/50 p-4">
					<div class="text-xs text-muted-foreground">{stat.label}</div>
					<div
						class="tabular mt-1 text-2xl font-semibold tracking-tight"
						style={stat.tone === 'held'
							? 'color: var(--held)'
							: stat.tone === 'hole' && counts.holes > 0
								? 'color: var(--hole)'
								: ''}
					>
						{stat.value}
					</div>
				</div>
			{/each}
		</div>

		<p class="mt-3 text-xs text-muted-foreground">
			Checked {coverage.checked.toLocaleString()} of {coverage.identified.toLocaleString()} shows{#if coverage.pending > 0},
				{coverage.pending.toLocaleString()}
				still queued{/if}{#if coverage.unidentified > 0}. {coverage.unidentified.toLocaleString()} aren't
				matched to a Plex show and can't be checked{/if}{#if coverage.failed > 0}. {coverage.failed.toLocaleString()}
				failed{/if}.
		</p>

		<div class="mt-6 flex flex-wrap items-center gap-2">
			{#each FILTERS as option (option.value)}
				<button
					type="button"
					onclick={() => setParam('only', option.value === 'all' ? null : option.value)}
					aria-pressed={data.filter === option.value}
					class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {data.filter ===
					option.value
						? 'border-transparent bg-foreground text-background'
						: 'hover:bg-accent'}"
				>
					{option.label}
				</button>
			{/each}

			<button
				type="button"
				onclick={() => setParam('seasons', data.allSeasons ? null : 'all')}
				aria-pressed={data.allSeasons}
				class="ml-auto text-xs text-muted-foreground underline-offset-4 hover:underline"
			>
				{data.allSeasons ? 'Only seasons I have' : 'Include seasons I have none of'}
			</button>
		</div>

		<!-- Legend. Three shapes need naming once; after that the list reads on its
		     own. -->
		<div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
			<span class="flex items-center gap-1.5"><StatusMark status="held" /> on the server</span>
			<span class="flex items-center gap-1.5"><StatusMark status="missing" /> missing</span>
			<span class="flex items-center gap-1.5">
				<StatusMark status="missing" gap="hole" /> gap inside a season
			</span>
			<span class="flex items-center gap-1.5"><StatusMark status="upcoming" /> not aired yet</span>
		</div>

		<Separator class="mt-6 mb-4" />

		<div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<div>
				{#if selectedShow}
					<div class="mb-3 flex items-center gap-3">
						<h2 class="text-sm font-medium">
							{data.report.shows.find((s) => s.showRatingKey === selectedShow)?.showTitle ?? 'Show'}
						</h2>
						<Button
							variant="ghost"
							size="sm"
							class="ml-auto h-7"
							onclick={() => setParam('show', null)}
						>
							Show everything
						</Button>
					</div>
				{/if}

				{#if shown.length === 0}
					<p class="py-10 text-center text-sm text-muted-foreground">
						{data.filter === 'holes'
							? 'No gaps inside seasons — every season you have runs unbroken.'
							: 'Nothing matches this filter.'}
					</p>
				{:else}
					<EpisodeList
						episodes={shown}
						timeZone={data.timeZone}
						showTitles={selectedShow === null}
					/>
					{#if visible.length > shown.length}
						<p class="py-4 text-center text-xs text-muted-foreground">
							Showing {shown.length.toLocaleString()} of {visible.length.toLocaleString()} — narrow by
							show or filter to see the rest.
						</p>
					{/if}
				{/if}
			</div>

			<aside>
				<h2 class="mb-3 text-sm font-medium">By show</h2>
				{#if data.report.shows.length === 0}
					<p class="text-xs text-muted-foreground">Nothing tracked yet.</p>
				{:else}
					<ShowRollup
						shows={data.report.shows}
						selected={selectedShow}
						onselect={(key) => setParam('show', key)}
					/>
				{/if}
			</aside>
		</div>

		{#if data.report.unknownAirDate > 0 || data.report.truncated}
			<p class="mt-8 text-center text-xs text-muted-foreground">
				{#if data.report.unknownAirDate > 0}
					{data.report.unknownAirDate.toLocaleString()} announced episodes have no air date and aren't
					counted either way.
				{/if}
				{#if data.report.truncated}
					The episode list was capped for this page.
				{/if}
			</p>
		{/if}
	{/if}
</div>
