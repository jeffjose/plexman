<script lang="ts">
	import { resolve } from '$app/paths';
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

	/** Rows drawn before the rest is left to the Schedule page. A dashboard
	 *  panel that scrolls has stopped being a summary. */
	const MAX_ROWS = 12;

	interface Row {
		id: string;
		serverId: string;
		showTitle: string;
		thumb: string | null;
		season: number;
		episodes: number[];
		/** Only shown when the row covers a single episode; a range has no one
		 *  title to name. */
		episodeTitle: string | null;
		status: ScheduleEpisode['status'];
		gap: ScheduleEpisode['gap'];
		daysUntil: number | null;
	}

	/** `[1,2,3,5]` → `E01–E03, E05`. */
	function compress(numbers: number[]): string {
		const sorted = [...numbers].sort((a, b) => a - b);
		const pad = (value: number) => String(value).padStart(2, '0');
		const parts: string[] = [];

		let start = sorted[0];
		let previous = sorted[0];
		for (let i = 1; i <= sorted.length; i++) {
			const current = sorted[i];
			if (current === previous + 1) {
				previous = current;
				continue;
			}
			parts.push(start === previous ? `E${pad(start)}` : `E${pad(start)}–E${pad(previous)}`);
			start = current;
			previous = current;
		}
		return parts.join(', ');
	}

	/**
	 * Grouped by day, then by show.
	 *
	 * Four episodes of one show landing on one date is one event, not four —
	 * listing them separately made the panel a table where the same title
	 * repeated down the page. The date moves into a header for the same reason:
	 * it was identical on every row it appeared beside.
	 */
	const days = $derived.by(() => {
		const byDay: Record<string, Record<string, Row>> = {};

		for (const episode of episodes) {
			if (!episode.airDate) continue;
			const rows = (byDay[episode.airDate] ??= {});

			// Status is part of the key: a show with one episode present and the
			// next absent has to stay two rows, or the marker would lie.
			const key = `${episode.showRatingKey}:${episode.season}:${episode.status}:${episode.gap ?? ''}`;
			const existing = rows[key];
			if (existing) {
				existing.episodes.push(episode.episode);
				existing.episodeTitle = null;
				continue;
			}
			rows[key] = {
				id: `${episode.id}:${key}`,
				serverId: episode.serverId,
				showTitle: episode.showTitle,
				thumb: episode.thumb,
				season: episode.season,
				episodes: [episode.episode],
				episodeTitle: episode.title,
				status: episode.status,
				gap: episode.gap,
				daysUntil: episode.daysUntil
			};
		}

		return Object.entries(byDay)
			.sort((a, b) => b[0].localeCompare(a[0]))
			.map(([date, rows]) => ({ date, rows: Object.values(rows) }));
	});

	/** Whole days only — truncating mid-day would imply a date was fully covered
	 *  when it wasn't. */
	const shown = $derived.by(() => {
		const out: typeof days = [];
		let count = 0;
		for (const day of days) {
			if (count > 0 && count + day.rows.length > MAX_ROWS) break;
			out.push(day);
			count += day.rows.length;
		}
		return out;
	});

	const shownCount = $derived(shown.reduce((sum, day) => sum + day.rows.length, 0));
	const totalRows = $derived(days.reduce((sum, day) => sum + day.rows.length, 0));

	function posterUrl(row: Row): string | null {
		if (!row.thumb) return null;
		const params = new URLSearchParams({
			server: row.serverId,
			path: row.thumb,
			w: '80',
			h: '120'
		});
		return `/api/image?${params}`;
	}

	function dayLabel(date: string): string {
		if (date === today) return 'Today';
		return formatDayLong(date).replace(/,? \d{4}$/, '');
	}

	function whenLabel(row: Row): string {
		if (row.status === 'missing') return 'not here';
		if (row.status !== 'upcoming') return '';
		const days = row.daysUntil ?? 0;
		return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
	}
</script>

<section>
	<div class="mb-2 flex items-baseline gap-2">
		<h2 class="text-sm font-medium">On air</h2>
		<span class="text-xs text-muted-foreground">shows you're keeping up with</span>
		<a
			href={resolve('/schedule')}
			class="ml-auto text-xs text-muted-foreground underline-offset-4 hover:underline"
		>
			schedule →
		</a>
	</div>

	{#if episodes.length === 0}
		<p class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
			Nothing aired in the last few days, and nothing lands in the next two.
		</p>
	{:else}
		<div class="flex flex-col">
			{#each shown as day (day.date)}
				<!-- Same day-header shape the Activity and Library timelines use. -->
				<div class="flex items-baseline gap-2 py-2">
					<h3 class="text-sm font-medium">{dayLabel(day.date)}</h3>
					{#if day.date < today}
						<span class="text-xs text-muted-foreground">{relativeDay(day.date, today)}</span>
					{/if}
				</div>

				<ol class="mb-1 flex flex-col">
					{#each day.rows as row (row.id)}
						{@const poster = posterUrl(row)}
						<li
							class="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40"
						>
							<StatusMark status={row.status} gap={row.gap} />

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
										class="size-full object-cover {row.status === 'missing'
											? 'opacity-40 grayscale'
											: row.status === 'upcoming'
												? 'opacity-60'
												: ''}"
									/>
								{/if}
							</div>

							<div class="min-w-0 flex-1">
								<div class="truncate text-sm font-medium">{row.showTitle}</div>
								<div class="truncate text-xs text-muted-foreground">
									<span class="tabular">
										S{String(row.season).padStart(2, '0')}{compress(row.episodes)}
									</span>
									{#if row.episodes.length > 1}
										<span class="px-1">·</span>{row.episodes.length} episodes
									{:else if row.episodeTitle}
										<span class="px-1">·</span>{row.episodeTitle}
									{/if}
								</div>
							</div>

							{#if whenLabel(row)}
								<div class="shrink-0 text-right">
									<div
										class="text-xs {row.status === 'missing'
											? 'font-medium'
											: 'text-muted-foreground'}"
									>
										{whenLabel(row)}
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			{/each}
		</div>

		<p class="tabular mt-2 px-2 text-xs text-muted-foreground">
			{counts.missing} missing · {counts.held} here · {counts.upcoming} landing
			{#if totalRows > shownCount}
				<span class="px-1">·</span>earlier on the schedule
			{/if}
		</p>
	{/if}
</section>
