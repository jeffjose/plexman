<script lang="ts">
	import {
		dayKeyInZone,
		formatDayLong,
		formatDuration,
		relativeDay,
		todayKey
	} from '$lib/activity/dates';
	import { Button } from '$lib/components/ui/button';
	import type { DeadWeight, DeadWeightItem } from './types';

	interface Props {
		deadWeight: DeadWeight;
		/** False when nothing in scope has a file size on record, which is what
		 *  decides whether the headline can be stated in bytes at all. */
		haveSizes: boolean;
		historyFrom: number | null;
		timeZone: string;
	}

	let { deadWeight, haveSizes, historyFrom, timeZone }: Props = $props();

	const PAGE = 50;

	let shown = $state(PAGE);

	// Collapse again when the scope changes underneath us; otherwise switching
	// servers keeps a depth that belonged to a different, longer list.
	$effect(() => {
		const { items } = deadWeight;
		shown = Math.min(PAGE, items.length);
	});

	const visible = $derived(deadWeight.items.slice(0, shown));
	const today = $derived(todayKey(timeZone));
	const totalSize = $derived(formatBytes(deadWeight.totalBytes));
	const totalRuntime = $derived(formatDuration(deadWeight.totalMs));

	/** Binary units, matching what a file manager reports for the same file. */
	function formatBytes(bytes: number | null): string | null {
		if (bytes == null || bytes <= 0) return null;
		const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit++;
		}
		return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
	}

	function posterUrl(item: DeadWeightItem): string | null {
		if (!item.thumb) return null;
		const params = new URLSearchParams({
			server: item.serverId,
			path: item.thumb,
			w: '80',
			h: '120'
		});
		return `/api/image?${params}`;
	}

	function countLabel(item: DeadWeightItem): string | null {
		if (item.itemCount === 1) return null;
		const unit = item.kind === 'show' ? 'episode' : item.kind === 'album' ? 'track' : 'item';
		return `${item.itemCount.toLocaleString()} ${unit}s`;
	}
</script>

<div class="rounded-xl border bg-card/50 p-5">
	<div class="text-xs text-muted-foreground">Reclaimable if deleted</div>
	{#if haveSizes && totalSize}
		<div class="tabular mt-1 text-3xl font-semibold tracking-tight">{totalSize}</div>
	{:else}
		<div class="mt-1 text-3xl font-semibold tracking-tight text-muted-foreground">—</div>
	{/if}
	<div class="tabular mt-1 text-sm text-muted-foreground">
		{deadWeight.totalItems.toLocaleString()} items across {deadWeight.totalGroups.toLocaleString()}
		titles{#if totalRuntime}
			· {totalRuntime} of runtime{/if}
	</div>

	{#if !haveSizes || !totalSize}
		<!-- Plex reports file sizes with the library listing, but they were only
		     recently kept, so a library synced before that has none. Saying so is
		     better than printing 0 B, which reads as "nothing to reclaim". -->
		<p class="mt-3 text-xs text-muted-foreground">
			No file sizes are on record for these libraries yet — a full re-sync fills them in. Until then
			the ranking below falls back to age, oldest first, and runtime stands in for size.
		</p>
	{/if}
</div>

<p class="mt-3 text-xs text-muted-foreground">
	Never played means no history row exists for any item in the title.
	{#if historyFrom}
		Our history only reaches back to {formatDayLong(dayKeyInZone(historyFrom, timeZone))}, so
		anything watched before then looks untouched here.
	{/if}
</p>

{#if deadWeight.items.length === 0}
	<p class="py-10 text-center text-sm text-muted-foreground">
		Everything in scope has been played at least once.
	</p>
{:else}
	<ol class="mt-4 flex flex-col">
		{#each visible as item (item.id)}
			{@const poster = posterUrl(item)}
			{@const day = dayKeyInZone(item.addedAt, timeZone)}
			{@const size = formatBytes(item.bytes)}
			{@const runtime = formatDuration(item.ms)}
			{@const count = countLabel(item)}
			<li class="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40">
				<div
					class="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-muted"
					style="box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--foreground) 8%, transparent)"
				>
					{#if poster}
						<img
							src={poster}
							alt=""
							loading="lazy"
							decoding="async"
							class="size-full object-cover"
						/>
					{/if}
				</div>

				<div class="min-w-0 flex-1">
					<div class="flex items-baseline gap-2">
						<span class="truncate text-sm font-medium">{item.title}</span>
						{#if item.year}
							<span class="tabular shrink-0 text-xs text-muted-foreground">{item.year}</span>
						{/if}
					</div>
					<div class="truncate text-xs text-muted-foreground" title={formatDayLong(day)}>
						{#if count}
							<span class="tabular">{count}</span><span class="px-1">·</span>
						{:else if item.subtitle}
							{item.subtitle}<span class="px-1">·</span>
						{/if}
						added {relativeDay(day, today)}
					</div>
				</div>

				<div class="shrink-0 text-right">
					<div class="tabular text-xs">{size ?? runtime ?? '—'}</div>
					<!-- Labelled, because with no sizes recorded this column silently
					     changes meaning and an unlabelled "14h" reads as a file size. -->
					<div class="text-[11px] text-muted-foreground">
						{size ? 'on disk' : runtime ? 'runtime' : ''}
					</div>
				</div>
			</li>
		{/each}
	</ol>

	{#if shown < deadWeight.items.length}
		<div class="flex justify-center py-4">
			<Button variant="ghost" size="sm" onclick={() => (shown += PAGE)}>Show more</Button>
		</div>
	{:else if deadWeight.totalGroups > deadWeight.items.length}
		<p class="py-6 text-center text-xs text-muted-foreground">
			Showing the top {deadWeight.items.length.toLocaleString()} of {deadWeight.totalGroups.toLocaleString()}
			never-played titles.
		</p>
	{/if}
{/if}
