<script lang="ts">
	import {
		dayKeyInZone,
		formatDayLong,
		formatTime,
		formatDuration,
		relativeDay,
		todayKey
	} from '$lib/activity/dates';
	import { TYPE_LABELS, type TimelineItem } from '$lib/activity/types';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		items: TimelineItem[];
		timeZone: string;
		hasMore: boolean;
		loading: boolean;
		onloadmore: () => void;
	}

	let { items, timeZone, hasMore, loading, onloadmore }: Props = $props();

	const today = $derived(todayKey(timeZone));

	/**
	 * Groups the flat page into day sections.
	 *
	 * Done here rather than server-side because pages arrive independently and a
	 * day routinely straddles a page boundary — grouping after concatenation is
	 * the only place the full picture exists.
	 */
	const sections = $derived.by(() => {
		const groups: { date: string; items: TimelineItem[] }[] = [];
		for (const item of items) {
			const date = dayKeyInZone(item.viewedAt, timeZone);
			const last = groups.at(-1);
			if (last?.date === date) last.items.push(item);
			else groups.push({ date, items: [item] });
		}
		return groups;
	});

	/**
	 * Fires `onloadmore` when the sentinel below the list scrolls into view.
	 *
	 * `rootMargin` starts the fetch a screen early so the next page is usually
	 * already there by the time the user reaches the bottom.
	 */
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

	function posterUrl(item: TimelineItem): string | null {
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
		<section>
			<!-- Sticky per-day header. `top-0` pins it under the page's own sticky
			     toolbar, which sets the scroll padding. -->
			<div
				class="sticky top-0 z-10 flex items-baseline gap-2 bg-background/80 py-2 backdrop-blur-sm"
			>
				<h3 class="text-sm font-medium">{formatDayLong(section.date)}</h3>
				<span class="text-xs text-muted-foreground">{relativeDay(section.date, today)}</span>
				<span class="tabular ml-auto text-xs text-muted-foreground">
					{section.items.length}
				</span>
			</div>

			<ol class="mb-2 flex flex-col">
				{#each section.items as item (item.serverId + item.historyKey)}
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
							{#if item.subtitle || item.seasonEpisode}
								<div class="truncate text-xs text-muted-foreground">
									{#if item.seasonEpisode}
										<span class="tabular">{item.seasonEpisode}</span>
										{#if item.subtitle}<span class="px-1">·</span>{/if}
									{/if}
									{item.subtitle ?? ''}
								</div>
							{/if}
						</div>

						<div class="shrink-0 text-right">
							<div class="tabular text-xs">{formatTime(item.viewedAt, timeZone)}</div>
							{#if formatDuration(item.duration)}
								<div class="tabular text-[11px] text-muted-foreground">
									{formatDuration(item.duration)}
								</div>
							{:else}
								<div class="text-[11px] text-muted-foreground">{TYPE_LABELS[item.type]}</div>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		</section>
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
			<!-- Visible fallback for anyone whose browser skips the observer, and a
			     manual escape hatch if a fetch failed. -->
			<Button variant="ghost" size="sm" onclick={onloadmore} disabled={loading}>
				{loading ? 'Loading…' : 'Load more'}
			</Button>
		</div>
	{:else if items.length > 0}
		<p class="py-6 text-center text-xs text-muted-foreground">That's everything.</p>
	{/if}
</div>
