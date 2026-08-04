<script lang="ts">
	import EpisodeStrip from './EpisodeStrip.svelte';
	import {
		dayKeyInZone,
		formatDayLong,
		formatDuration,
		relativeDay,
		todayKey
	} from '$lib/activity/dates';
	import type { PartWatchedShow } from './types';

	interface Props {
		shows: PartWatchedShow[];
		timeZone: string;
		empty: string;
	}

	let { shows, timeZone, empty }: Props = $props();

	const today = $derived(todayKey(timeZone));

	function posterUrl(show: PartWatchedShow): string | null {
		if (!show.thumb) return null;
		const params = new URLSearchParams({
			server: show.serverId,
			path: show.thumb,
			w: '80',
			h: '120'
		});
		return `/api/image?${params}`;
	}

	function episodeCode(season: number | null, episode: number | null): string | null {
		if (season == null && episode == null) return null;
		const seasonPart = season == null ? '' : `S${String(season).padStart(2, '0')}`;
		const episodePart = episode == null ? '' : `E${String(episode).padStart(2, '0')}`;
		return `${seasonPart}${episodePart}`;
	}
</script>

{#if shows.length === 0}
	<p class="py-10 text-center text-sm text-muted-foreground">{empty}</p>
{:else}
	<ol class="flex flex-col">
		{#each shows as show (show.id)}
			{@const poster = posterUrl(show)}
			{@const day = dayKeyInZone(show.lastViewedAt, timeZone)}
			{@const left = show.ownedEpisodes - show.watchedEpisodes}
			{@const remaining = formatDuration(show.remainingMs)}
			{@const stoppedAt = episodeCode(show.lastSeason, show.lastEpisode)}
			{@const nextCode = show.next && episodeCode(show.next.season, show.next.episode)}
			<li class="flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-accent/40">
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
						<span class="truncate text-sm font-medium">{show.title}</span>
						{#if show.year}
							<span class="tabular shrink-0 text-xs text-muted-foreground">{show.year}</span>
						{/if}
					</div>

					<!-- A bar gives the ratio; the strip gives the shape. Whether you
					     watched six straight and stopped, or dipped in and out across a
					     season, is the thing that says what happened — and a percentage
					     renders both identically.

					     Progress is over episodes you *own*, not over the show as it
					     aired: 8 of 10 owned reads very differently once you know the
					     other twelve were never downloaded. -->
					<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
						<EpisodeStrip markers={show.markers} resumeIndex={show.resumeIndex} />
						<span class="tabular text-xs text-muted-foreground">
							{show.watchedEpisodes} of {show.ownedEpisodes} owned
						</span>
					</div>

					<div class="mt-1 truncate text-xs text-muted-foreground">
						{#if show.next}
							{#if show.next.behind}
								<!-- Nothing after where they stopped, so what's left is a hole
								     earlier in the run rather than a place to resume. -->
								<span class="text-foreground/70">Gap</span>
							{:else}
								<span class="text-foreground/70">Next</span>
							{/if}
							<span class="tabular px-1">{nextCode ?? '—'}</span>{show.next.title}
						{/if}
						{#if show.skipped > 0 && !show.next?.behind}
							<span class="px-1">·</span>{show.skipped} skipped earlier
						{/if}
					</div>
				</div>

				<div class="shrink-0 text-right">
					<div class="text-xs" title={formatDayLong(day)}>{relativeDay(day, today)}</div>
					<div class="tabular mt-0.5 text-[11px] text-muted-foreground">
						{left} left{remaining ? ` · ${remaining}` : ''}
					</div>
					{#if stoppedAt}
						<div class="tabular text-[11px] text-muted-foreground">stopped at {stoppedAt}</div>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
{/if}
