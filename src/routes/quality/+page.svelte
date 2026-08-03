<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Nav from '$lib/components/Nav.svelte';
	import MediaMix from '$lib/components/quality/MediaMix.svelte';
	import QualityTiers from '$lib/components/quality/QualityTiers.svelte';
	import QualityTrend from '$lib/components/quality/QualityTrend.svelte';
	import StorageGrowth from '$lib/components/quality/StorageGrowth.svelte';
	import WorklistTable from '$lib/components/quality/WorklistTable.svelte';
	import { formatBitrate, formatBytes, formatMonth } from '$lib/components/quality/format';
	import { Button } from '$lib/components/ui/button';
	import { createSync } from '$lib/sync.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sync = createSync();

	/**
	 * Section labels, qualified by server only when they'd otherwise collide.
	 *
	 * Same treatment as the Library page: two servers both having a library called
	 * "Movies" is the normal case, and two identical chips is unreadable.
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

	// Plain arrays rather than Sets: these are short lists rebuilt on every URL
	// change, and `svelte/prefer-svelte-reactivity` rightly objects to a mutable
	// Set in reactive scope.
	const selectedSections = $derived(
		page.url.searchParams
			.getAll('section')
			.flatMap((value) => value.split(','))
			.filter(Boolean)
	);

	function toggleSection(id: string) {
		const next = new URL(page.url);
		const selected = selectedSections.includes(id)
			? selectedSections.filter((value) => value !== id)
			: [...selectedSections, id];

		next.searchParams.delete('section');
		// All-selected and none-selected describe the same set, so the parameter is
		// dropped rather than listing every library back to the server.
		if (selected.length > 0 && selected.length < data.sections.length) {
			for (const value of selected) next.searchParams.append('section', value);
		}

		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(next, { keepFocus: true, noScroll: true });
	}

	const neverSynced = $derived(data.sections.length === 0);

	/**
	 * The media columns arrived after the first version of the library sync, so a
	 * collection synced before then has every row but none of the detail. That
	 * reads as an empty page unless it's called out, and the fix — a full re-sync
	 * rather than the incremental one the Sync button runs — isn't guessable.
	 */
	const needsFullSync = $derived(
		!neverSynced &&
			data.overview.items > 0 &&
			data.overview.rated === 0 &&
			data.overview.sized === 0
	);

	const latestMonth = $derived(
		[...data.overview.months].reverse().find((month) => month.medianBitrate !== null) ?? null
	);

	const stats = $derived([
		{
			label: 'On disk',
			value: formatBytes(data.overview.totalBytes),
			hint: `${data.overview.sized.toLocaleString()} of ${data.overview.items.toLocaleString()} items measured`
		},
		{
			label: 'Latest quality',
			value: formatBitrate(latestMonth?.medianBitrate ?? null),
			hint: latestMonth ? `median video, ${formatMonth(latestMonth.month)}` : 'no video added yet'
		},
		{
			label: 'Still H.264',
			value: data.overview.h264Items.toLocaleString(),
			hint: `${formatBytes(data.overview.h264Bytes)} of the collection`
		},
		{
			label: 'Duplicate waste',
			value: formatBytes(data.overview.duplicateWaste),
			hint: `${data.overview.duplicateItems.toLocaleString()} items with extra versions`
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
			<h2 class="font-medium">No libraries synced yet</h2>
			<p class="mx-auto mt-2 max-w-sm text-sm text-balance text-muted-foreground">
				Pull your libraries to see what your files actually are. The first run walks every item and
				can take a minute or two.
			</p>
			<Button class="mt-5" onclick={() => sync.run(true)} disabled={sync.syncing}>
				{sync.syncing ? 'Syncing…' : 'Sync libraries'}
			</Button>
		</div>
	{:else if needsFullSync}
		<div class="rounded-xl border border-dashed p-10 text-center">
			<h2 class="font-medium">Media details haven't been synced yet</h2>
			<p class="mx-auto mt-2 max-w-md text-sm text-balance text-muted-foreground">
				Bitrates, codecs and file sizes come from a full re-sync — the incremental one only fetches
				what's new, so your {data.overview.items.toLocaleString()} existing items have no detail to read.
				This walks every library again.
			</p>
			<Button class="mt-5" onclick={() => sync.run(true)} disabled={sync.syncing}>
				{sync.syncing ? 'Syncing…' : 'Run a full sync'}
			</Button>
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{#each stats as stat (stat.label)}
				<div class="rounded-xl border bg-card/50 p-4">
					<div class="text-xs text-muted-foreground">{stat.label}</div>
					<div class="tabular mt-1 text-2xl font-semibold tracking-tight">{stat.value}</div>
					<div class="mt-0.5 truncate text-[11px] text-muted-foreground">{stat.hint}</div>
				</div>
			{/each}
		</div>

		{#if data.sections.length > 1}
			<div class="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
				{#each data.sections as section (section.id)}
					{@const on = selectedSections.length === 0 || selectedSections.includes(section.id)}
					<button
						type="button"
						onclick={() => toggleSection(section.id)}
						class="group flex items-center gap-2 text-xs transition-opacity {on
							? 'text-foreground'
							: 'text-muted-foreground'}"
						aria-pressed={on}
					>
						<span
							class="flex size-3.5 items-center justify-center rounded-[4px] border transition-colors {on
								? 'border-foreground bg-foreground text-background'
								: 'border-input group-hover:border-foreground/40'}"
							aria-hidden="true"
						>
							{#if on}
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
					</button>
				{/each}

				{#if selectedSections.length > 0}
					<Button
						variant="ghost"
						size="sm"
						class="ml-auto h-7"
						onclick={() => goto(resolve('/quality'))}
					>
						Clear filters
					</Button>
				{/if}
			</div>
		{/if}

		<div class="mt-6 flex flex-col gap-4">
			<QualityTiers
				tiers={data.overview.tiers}
				unranked={data.overview.unranked}
				sections={data.overview.sections}
				{sectionLabels}
			/>

			<QualityTrend months={data.overview.months} />

			<MediaMix resolutions={data.overview.resolutions} codecs={data.overview.codecs} />

			<StorageGrowth
				months={data.overview.months}
				sections={data.overview.sections}
				{sectionLabels}
				totalBytes={data.overview.totalBytes}
			/>

			<WorklistTable
				title="Worth re-encoding"
				description="H.264 files, biggest first"
				caveat="An estimate: HEVC is assumed to be 40% smaller at similar quality, which real encodes hit anywhere from 25% to 60% of."
				items={data.reencode}
				{sectionLabels}
				kind="reencode"
				emptyMessage="Nothing here is still H.264."
			/>

			<WorklistTable
				title="Duplicate files"
				description="Items Plex holds more than one copy of"
				caveat="An estimate: Plex reports one combined size per item, so this assumes the extra versions are about as big as the one you'd keep."
				items={data.duplicates}
				{sectionLabels}
				kind="duplicate"
				emptyMessage="No item has more than one version."
			/>
		</div>
	{/if}
</div>
