<script lang="ts">
	import StatusMark from './StatusMark.svelte';
	import { formatDayLong, relativeDay, todayKey } from '$lib/activity/dates';
	import type { ScheduleEpisode } from '$lib/server/queries/schedule';

	interface Props {
		episodes: ScheduleEpisode[];
		timeZone: string;
		/** Hide the show name when the list is already scoped to one show. */
		showTitles?: boolean;
	}

	let { episodes, timeZone, showTitles = true }: Props = $props();

	const today = $derived(todayKey(timeZone));

	function posterUrl(episode: ScheduleEpisode): string | null {
		if (!episode.thumb) return null;
		const params = new URLSearchParams({
			server: episode.serverId,
			path: episode.thumb,
			w: '80',
			h: '120'
		});
		return `/api/image?${params}`;
	}

	function code(episode: ScheduleEpisode): string {
		return `S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`;
	}

	function whenLabel(episode: ScheduleEpisode): string {
		if (!episode.airDate) return 'no date announced';
		if (episode.status !== 'upcoming') return relativeDay(episode.airDate, today);

		const days = episode.daysUntil ?? 0;
		if (days <= 0) return 'today';
		if (days === 1) return 'tomorrow';
		if (days < 7) return `in ${days} days`;
		if (days < 30) return `in ${Math.round(days / 7)} weeks`;
		return `in ${Math.round(days / 30)} months`;
	}
</script>

<ol class="flex flex-col">
	{#each episodes as episode (episode.id)}
		{@const poster = posterUrl(episode)}
		<li
			class="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40 {episode.status ===
			'upcoming'
				? 'opacity-75'
				: ''}"
		>
			<StatusMark status={episode.status} gap={episode.gap} />

			<!-- Upcoming rows get a dashed frame so an unaired episode stays legible
			     as "not yet" even when the marker is out of the eye's path. -->
			<div
				class="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted {episode.status ===
				'upcoming'
					? 'border border-dashed border-muted-foreground/40'
					: ''}"
			>
				{#if poster}
					<img
						src={poster}
						alt=""
						loading="lazy"
						decoding="async"
						class="size-full object-cover {episode.status === 'missing'
							? 'opacity-40 grayscale'
							: ''}"
					/>
				{/if}
			</div>

			<div class="min-w-0 flex-1">
				<div class="flex items-baseline gap-2">
					<span class="tabular shrink-0 text-xs text-muted-foreground">{code(episode)}</span>
					<span class="truncate text-sm {episode.status === 'held' ? '' : 'font-medium'}">
						{episode.title ?? 'Untitled'}
					</span>
				</div>
				<div class="truncate text-xs text-muted-foreground">
					{#if showTitles}
						{episode.showTitle}<span class="px-1">·</span>
					{/if}
					{episode.airDate ? formatDayLong(episode.airDate).replace(/^\w+, /, '') : 'TBA'}
					<span class="px-1">·</span>{whenLabel(episode)}
					{#if episode.gap === 'hole'}
						<span class="px-1">·</span><span style="color: var(--hole)">gap</span>
					{/if}
				</div>
			</div>
		</li>
	{/each}
</ol>
