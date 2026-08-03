<script lang="ts">
	import {
		dayKeyInZone,
		formatDayLong,
		formatTime,
		relativeDay,
		todayKey
	} from '$lib/activity/dates';
	import { TYPE_LABELS } from '$lib/activity/types';
	import type { LibraryAddition } from '$lib/activity/library';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		items: LibraryAddition[];
		sectionTitles: Record<string, string>;
		timeZone: string;
		hasMore: boolean;
		loading: boolean;
		onloadmore: () => void;
	}

	let { items, sectionTitles, timeZone, hasMore, loading, onloadmore }: Props = $props();

	const today = $derived(todayKey(timeZone));

	const sections = $derived.by(() => {
		const groups: { date: string; items: LibraryAddition[]; total: number }[] = [];
		for (const item of items) {
			const date = dayKeyInZone(item.addedAt, timeZone);
			const last = groups.at(-1);
			if (last?.date === date) {
				last.items.push(item);
				last.total += item.itemCount;
			} else {
				groups.push({ date, items: [item], total: item.itemCount });
			}
		}
		return groups;
	});

	function infiniteScroll(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) onloadmore();
			},
			{ rootMargin: '600px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	function unitFor(item: LibraryAddition): string {
		const unit = item.type === 'episode' ? 'episode' : item.type === 'track' ? 'track' : 'item';
		return item.itemCount === 1 ? unit : `${unit}s`;
	}

	function posterUrl(item: LibraryAddition): string | null {
		if (!item.thumb) return null;
		const params = new URLSearchParams({
			server: item.serverId,
			path: item.thumb,
			w: '80',
			h: '120'
		});
		return `/api/image?${params}`;
	}
</script>

<div class="flex flex-col">
	{#each sections as section (section.date)}
		<div class="sticky top-0 z-10 flex items-baseline gap-2 bg-background/80 py-2 backdrop-blur-sm">
			<h3 class="text-sm font-medium">{formatDayLong(section.date)}</h3>
			<span class="text-xs text-muted-foreground">{relativeDay(section.date, today)}</span>
			<span class="tabular ml-auto text-xs text-muted-foreground">
				+{section.total.toLocaleString()}
			</span>
		</div>

		<ol class="mb-2 flex flex-col">
			{#each section.items as item (item.id)}
				{@const poster = posterUrl(item)}
				<li
					class="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40"
				>
					<div
						class="relative size-11 shrink-0 overflow-hidden rounded-md bg-muted"
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
							{#if item.year && item.type === 'movie'}
								<span class="tabular shrink-0 text-xs text-muted-foreground">{item.year}</span>
							{/if}
						</div>
						<div class="truncate text-xs text-muted-foreground">
							{sectionTitles[`${item.serverId}:${item.sectionKey}`] ?? TYPE_LABELS[item.type]}
							{#if item.itemCount > 1}
								<!-- Spelled out because a grouped row is one season *on one
								     day*, not a whole season — "+4" alone reads as though the
								     season arrived complete. -->
								<span class="px-1">·</span><span class="tabular text-foreground"
									>{item.itemCount}
									{unitFor(item)}</span
								>
								{#if item.range}
									<span class="px-1">·</span><span class="tabular">{item.range}</span>
								{/if}
							{:else if item.subtitle}
								<span class="px-1">·</span>{item.subtitle}
							{/if}
						</div>
					</div>

					<!-- The count now lives in the subtitle, where it can be spelled
					     out; this column stays the clock so rows align down the page. -->
					<div class="shrink-0 text-right">
						<div class="tabular text-xs">{formatTime(item.addedAt, timeZone)}</div>
						<div class="text-[11px] text-muted-foreground">{TYPE_LABELS[item.type]}</div>
					</div>
				</li>
			{/each}
		</ol>
	{/each}

	{#if loading}
		<div class="flex flex-col gap-2 py-2">
			{#each [0, 1, 2, 3] as index (index)}
				<div class="flex items-center gap-3 px-2">
					<Skeleton class="size-11 shrink-0 rounded-md" />
					<div class="flex-1 space-y-2">
						<Skeleton class="h-3.5 w-2/5" />
						<Skeleton class="h-3 w-1/4" />
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if hasMore}
		<div use:infiniteScroll class="flex justify-center py-4">
			<Button variant="ghost" size="sm" onclick={onloadmore} disabled={loading}>
				{loading ? 'Loading…' : 'Load more'}
			</Button>
		</div>
	{:else if items.length > 0}
		<p class="py-6 text-center text-xs text-muted-foreground">That's the whole library.</p>
	{/if}
</div>
