<script lang="ts">
	import Nav from '$lib/components/Nav.svelte';
	import DeadWeightList from '$lib/components/unfinished/DeadWeightList.svelte';
	import ShowProgressList from '$lib/components/unfinished/ShowProgressList.svelte';
	import * as Tabs from '$lib/components/ui/tabs';
	import { createSync } from '$lib/sync.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sync = createSync();

	const unfinished = $derived(data.unfinished);

	let tab = $state('dropped');

	const tabs = $derived([
		{ value: 'dropped', label: 'Dropped', count: unfinished.dropped.length },
		{ value: 'stale', label: 'Stale', count: unfinished.stale.length },
		{ value: 'dead', label: 'Never played', count: unfinished.deadWeight.totalGroups }
	]);

	const stats = $derived([
		{
			label: 'Dropped shows',
			value: unfinished.dropped.length.toLocaleString(),
			hint: `idle over ${unfinished.droppedAfterDays} days`
		},
		{
			label: 'Stale in progress',
			value: unfinished.stale.length.toLocaleString(),
			hint: `${unfinished.staleAfterDays}–${unfinished.droppedAfterDays} days idle`
		},
		{
			label: 'Never played',
			value: unfinished.deadWeight.totalGroups.toLocaleString(),
			hint: `${unfinished.deadWeight.totalItems.toLocaleString()} items`
		},
		{
			label: 'Still on the go',
			value: unfinished.activeShows.toLocaleString(),
			hint: `watched in the last ${unfinished.staleAfterDays} days`
		}
	]);
</script>

<div class="mx-auto min-h-svh w-full max-w-5xl px-4 pb-24 sm:px-6">
	<Nav
		syncing={sync.syncing}
		onsync={() => sync.run()}
		servers={data.servers}
		serverScope={data.serverScope}
	/>

	{#if sync.message}
		<p
			class="mb-4 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
			role="status"
		>
			{sync.message}
		</p>
	{/if}

	<!-- Stated once, at the top, because it constrains every number on the page:
	     Plex's history says an item was played, never how far into it you got. -->
	<p class="mb-6 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
		Plex records that something was <em>played</em>, not how far you got. A film you abandoned after
		twenty minutes is indistinguishable from one you finished, so nothing here claims to know that.
		What it can tell you is which episodes you own but never started.
	</p>

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each stats as stat (stat.label)}
			<div class="rounded-xl border bg-card/50 p-4">
				<div class="text-xs text-muted-foreground">{stat.label}</div>
				<div class="tabular mt-1 text-2xl font-semibold tracking-tight">{stat.value}</div>
				<div class="mt-0.5 truncate text-[11px] text-muted-foreground">{stat.hint}</div>
			</div>
		{/each}
	</div>

	<Tabs.Root bind:value={tab} class="mt-8">
		<Tabs.List>
			{#each tabs as entry (entry.value)}
				<Tabs.Trigger value={entry.value}>
					{entry.label}
					<span class="tabular text-muted-foreground">{entry.count.toLocaleString()}</span>
				</Tabs.Trigger>
			{/each}
		</Tabs.List>

		<Tabs.Content value="dropped" class="mt-4">
			<p class="mb-3 text-xs text-muted-foreground">
				Shows you got into and stopped, with episodes you own still unplayed. Nothing has been
				played for over {unfinished.droppedAfterDays} days — longer than a between-seasons gap or a holiday,
				which is what makes it a decision rather than a pause. Oldest silence first.
			</p>
			<ShowProgressList
				shows={unfinished.dropped}
				timeZone={data.timeZone}
				empty="Nothing has been abandoned that long."
			/>
		</Tabs.Content>

		<Tabs.Content value="stale" class="mt-4">
			<p class="mb-3 text-xs text-muted-foreground">
				Still plausibly in progress: last played between {unfinished.staleAfterDays} and {unfinished.droppedAfterDays}
				days ago. Under {unfinished.staleAfterDays} days a weekly show that skipped a week would land
				here, which is why the list starts where it does.
			</p>
			<ShowProgressList
				shows={unfinished.stale}
				timeZone={data.timeZone}
				empty="Nothing is sitting in that window."
			/>
		</Tabs.Content>

		<Tabs.Content value="dead" class="mt-4">
			<DeadWeightList
				deadWeight={unfinished.deadWeight}
				haveSizes={unfinished.haveSizes}
				historyFrom={unfinished.historyFrom}
				timeZone={data.timeZone}
			/>
		</Tabs.Content>
	</Tabs.Root>
</div>
