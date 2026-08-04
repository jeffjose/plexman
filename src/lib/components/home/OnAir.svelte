<script lang="ts">
	import StatusMark from '$lib/components/schedule/StatusMark.svelte';
	import { formatDayLong, relativeDay, todayKey } from '$lib/activity/dates';
	import type { ScheduleEpisode } from '$lib/server/queries/schedule';

	interface Props {
		episodes: ScheduleEpisode[];
		counts: { missing: number; held: number; upcoming: number };
		timeZone: string;
	}

	let { episodes, counts, timeZone }: Props = $props();

	const today = $derived(todayKey(timeZone));

	/**
	 * Split at today so the list reads as a timeline rather than a ranking.
	 *
	 * Aired above, still to come below, with the boundary drawn explicitly —
	 * the point of the strip is "where am I relative to now", which a single
	 * sorted list leaves the reader to work out.
	 */
	const aired = $derived(episodes.filter((episode) => episode.status !== 'upcoming'));
	const ahead = $derived(
		[...episodes.filter((episode) => episode.status === 'upcoming')].sort((a, b) =>
			(a.airDate ?? '').localeCompare(b.airDate ?? '')
		)
	);

	function code(episode: ScheduleEpisode): string {
		return `S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`;
	}

	function shortDate(airDate: string | null): string {
		if (!airDate) return 'TBA';
		return formatDayLong(airDate)
			.replace(/^(\w{3})\w*, /, '$1 ')
			.replace(/ \d{4}$/, '');
	}

	function whenLabel(episode: ScheduleEpisode): string {
		if (!episode.airDate) return '';
		if (episode.status === 'upcoming') {
			const days = episode.daysUntil ?? 0;
			return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
		}
		return relativeDay(episode.airDate, today);
	}
</script>

<section>
	<div class="mb-1 flex items-baseline gap-2">
		<h2 class="text-sm font-medium">On air</h2>
		<span class="text-xs text-muted-foreground">shows you're keeping up with</span>
	</div>

	{#if episodes.length === 0}
		<p class="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
			Nothing aired in the last few days and nothing lands in the next two.
		</p>
	{:else}
		<ol class="flex flex-col">
			{#each aired as episode (episode.id)}
				<li class="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/40">
					<StatusMark status={episode.status} gap={episode.gap} />
					<span class="tabular w-14 shrink-0 text-xs text-muted-foreground">
						{shortDate(episode.airDate)}
					</span>
					<span class="min-w-0 flex-1 truncate text-sm">{episode.showTitle}</span>
					<span class="tabular shrink-0 text-xs text-muted-foreground">{code(episode)}</span>
					<span
						class="w-20 shrink-0 text-right text-xs {episode.status === 'missing'
							? 'font-medium'
							: 'text-muted-foreground'}"
					>
						{episode.status === 'missing' ? 'not here' : whenLabel(episode)}
					</span>
				</li>
			{/each}

			<!-- The boundary is the whole point of the section, so it's drawn rather
			     than implied by ordering. -->
			<li class="my-1 flex items-center gap-3 px-2" aria-hidden="true">
				<span class="h-px flex-1 bg-border"></span>
				<span class="text-[11px] text-muted-foreground">today · {shortDate(today)}</span>
				<span class="h-px flex-1 bg-border"></span>
			</li>

			{#each ahead as episode (episode.id)}
				<li class="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/40">
					<StatusMark status={episode.status} gap={episode.gap} />
					<span class="tabular w-14 shrink-0 text-xs text-muted-foreground">
						{shortDate(episode.airDate)}
					</span>
					<span class="min-w-0 flex-1 truncate text-sm">{episode.showTitle}</span>
					<span class="tabular shrink-0 text-xs text-muted-foreground">{code(episode)}</span>
					<span class="w-20 shrink-0 text-right text-xs text-muted-foreground">
						{whenLabel(episode)}
					</span>
				</li>
			{/each}
		</ol>

		<p class="tabular mt-2 px-2 text-xs text-muted-foreground">
			{counts.missing} missing · {counts.held} here · {counts.upcoming} landing
		</p>
	{/if}
</section>
