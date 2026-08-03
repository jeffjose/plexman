<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Nav from '$lib/components/Nav.svelte';
	import EpisodeList from '$lib/components/missing/EpisodeList.svelte';
	import ShowRollup from '$lib/components/missing/ShowRollup.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { dayKeyInZone, formatTime, relativeDay, todayKey } from '$lib/activity/dates';
	import { createSync } from '$lib/sync.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sync = createSync();

	const WINDOWS = [
		{ value: '60', label: '60 days' },
		{ value: '365', label: 'A year' },
		{ value: 'all', label: 'All time' }
	];

	const SEASON_SCOPES = [
		{ value: 'held', label: 'Seasons I have' },
		{ value: 'all', label: 'Every season' }
	];

	const activeWindow = $derived(
		data.missing.windowDays === null ? 'all' : String(data.missing.windowDays)
	);
	const activeScope = $derived(data.missing.heldSeasonsOnly ? 'held' : 'all');

	function updateUrl(key: string, value: string, fallback: string) {
		const next = new URL(page.url);
		if (value === fallback) next.searchParams.delete(key);
		else next.searchParams.set(key, value);
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(next, { keepFocus: true, noScroll: true });
	}

	const today = $derived(todayKey(data.timeZone));

	/** When the canonical lists were last refreshed. Shown as a clock time on the
	 *  day it happened and a day count after that — "14:32" is only meaningful
	 *  while it's still today. */
	function checkedLabel(unixSeconds: number | null): string {
		if (unixSeconds === null) return 'never';
		const day = dayKeyInZone(unixSeconds, data.timeZone);
		return day === today ? formatTime(unixSeconds, data.timeZone) : relativeDay(day, today);
	}

	const coverage = $derived(data.missing.coverage);
	const neverSynced = $derived(coverage.total === 0);
	const neverChecked = $derived(coverage.checked === 0);

	const stats = $derived([
		{
			label: 'Missing episodes',
			value: data.missing.recent.length.toLocaleString(),
			hint: data.missing.older > 0 ? `${data.missing.older} older, outside the window` : null
		},
		{
			label: 'Shows with gaps',
			value: data.missing.byShow.length.toLocaleString(),
			hint: null
		},
		{
			label: 'Coming soon',
			value: data.missing.upcoming.length.toLocaleString(),
			hint: data.missing.upcoming[0] ? `next ${data.missing.upcoming[0].airDate}` : null
		},
		{
			label: 'Last checked',
			value: checkedLabel(coverage.newestCheckedAt),
			hint: `${coverage.checked} of ${coverage.identified} shows`
		}
	]);
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

	{#if neverSynced}
		<div class="rounded-xl border border-dashed p-10 text-center">
			<h2 class="font-medium">No shows synced yet</h2>
			<p class="mx-auto mt-2 max-w-sm text-sm text-balance text-muted-foreground">
				Pull your libraries first. Once Plexman knows which shows you have, it can ask Plex what
				episodes they should have.
			</p>
			<Button class="mt-5" onclick={() => sync.run(true)} disabled={sync.syncing}>
				{sync.syncing ? 'Syncing…' : 'Sync libraries'}
			</Button>
		</div>
	{:else if neverChecked}
		<div class="rounded-xl border border-dashed p-10 text-center">
			<h2 class="font-medium">No shows checked yet</h2>
			<p class="mx-auto mt-2 max-w-sm text-sm text-balance text-muted-foreground">
				{coverage.identified} of your {coverage.total} shows can be looked up against Plex's own metadata.
				Each sync checks the ones most likely to have gained an episode, starting with whatever is currently
				airing.
			</p>
			<Button class="mt-5" onclick={() => sync.run()} disabled={sync.syncing}>
				{sync.syncing ? 'Checking…' : 'Check for missing episodes'}
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

		<div class="mt-8 flex flex-wrap items-center gap-3">
			<h2 class="text-sm font-medium">Aired, but not on your server</h2>

			<div class="ml-auto flex flex-wrap items-center gap-2">
				<div class="flex rounded-lg bg-muted p-0.5" role="group" aria-label="How far back to look">
					{#each WINDOWS as option (option.value)}
						<button
							type="button"
							onclick={() => updateUrl('since', option.value, '60')}
							aria-pressed={activeWindow === option.value}
							class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors {activeWindow ===
							option.value
								? 'bg-background shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							{option.label}
						</button>
					{/each}
				</div>

				<!-- Keeping only the current season of a long-running show is a choice,
				     not a gap, so the default only reports inside seasons you've kept
				     something from. The other setting is here because "show me
				     everything" is a fair question, just not a useful default. -->
				<div
					class="flex rounded-lg bg-muted p-0.5"
					role="group"
					aria-label="Which seasons to count"
				>
					{#each SEASON_SCOPES as option (option.value)}
						<button
							type="button"
							onclick={() => updateUrl('seasons', option.value, 'held')}
							aria-pressed={activeScope === option.value}
							class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors {activeScope ===
							option.value
								? 'bg-background shadow-sm'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							{option.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		{#if data.missing.byShow.length > 0}
			<div class="mt-4">
				<ShowRollup shows={data.missing.byShow} />
			</div>
		{/if}

		<Separator class="mt-6 mb-2" />

		{#if data.missing.recent.length === 0}
			<div class="py-10 text-center">
				<p class="text-sm">Nothing missing in this window.</p>
				<p class="mx-auto mt-1 max-w-sm text-xs text-balance text-muted-foreground">
					{#if data.missing.older > 0}
						{data.missing.older} older episodes are missing — widen the window to see them.
					{:else}
						Every episode that has aired in the seasons you keep is on your server.
					{/if}
				</p>
			</div>
		{:else}
			<EpisodeList items={data.missing.recent} timeZone={data.timeZone} />
		{/if}

		{#if data.missing.upcoming.length > 0}
			<div class="mt-10">
				<div class="flex items-baseline gap-2">
					<h2 class="text-sm font-medium">Coming soon</h2>
					<span class="text-xs text-muted-foreground">
						announced, not aired — nothing to go and find yet
					</span>
				</div>
				<Separator class="mt-3 mb-2" />
				<EpisodeList items={data.missing.upcoming} timeZone={data.timeZone} upcoming />
			</div>
		{/if}

		<!-- What the check hasn't got to. A missing-episode page that doesn't say
		     how much of the library it has actually looked at is making a claim it
		     can't support. -->
		<p class="mt-10 text-xs leading-relaxed text-balance text-muted-foreground">
			Checked {coverage.checked.toLocaleString()} of {coverage.identified.toLocaleString()} shows Plex
			can identify{coverage.pending > 0 ? `; ${coverage.pending} still waiting` : ''}. Oldest check {checkedLabel(
				coverage.oldestCheckedAt
			)}, newest {checkedLabel(coverage.newestCheckedAt)}.
			{#if coverage.unidentified > 0}
				{coverage.unidentified} shows have no Plex match (home videos, YouTube channels) and can't be
				checked.
			{/if}
			{#if coverage.failed > 0}
				{coverage.failed} shows failed their last check.
			{/if}
			{#if data.missing.unknownAirDate > 0}
				{data.missing.unknownAirDate} announced episodes have no air date and are counted as unknown rather
				than missing.
			{/if}
			{#if data.missing.truncated}
				This list was capped; some older gaps aren't shown.
			{/if}
		</p>
	{/if}
</div>
