<script lang="ts">
	import { resolve } from '$app/paths';
	import StatusMark from '$lib/components/schedule/StatusMark.svelte';
	import { relativeDay, todayKey } from '$lib/activity/dates';
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
	const MAX_ROWS = 14;

	interface Row {
		id: string;
		showTitle: string;
		season: number;
		episodes: number[];
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
	 * listing them separately turned the panel into a table where the same title
	 * repeated down the page and the actual variety was invisible. The date moves
	 * into a header for the same reason: it was identical on every row it
	 * appeared beside.
	 */
	const days = $derived.by(() => {
		const byDay: Record<string, Record<string, Row>> = {};

		for (const episode of episodes) {
			if (!episode.airDate) continue;
			const rows = (byDay[episode.airDate] ??= {});

			// Status is part of the key: a show with one episode present and the
			// next absent has to stay two rows, or the marker would lie.
			const key = `${episode.showRatingKey}:${episode.season}:${episode.status}:${episode.gap ?? ''}`;
			if (rows[key]) {
				rows[key].episodes.push(episode.episode);
				continue;
			}
			rows[key] = {
				id: `${episode.id}:${key}`,
				showTitle: episode.showTitle,
				season: episode.season,
				episodes: [episode.episode],
				status: episode.status,
				gap: episode.gap,
				daysUntil: episode.daysUntil
			};
		}

		return Object.entries(byDay)
			.sort((a, b) => b[0].localeCompare(a[0]))
			.map(([date, rows]) => ({ date, rows: Object.values(rows) }));
	});

	const totalRows = $derived(days.reduce((sum, day) => sum + day.rows.length, 0));

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

	function dayLabel(date: string): string {
		if (date === today) return 'Today';
		return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	}

	function whenLabel(row: Row): string {
		if (row.status === 'missing') return 'not here';
		if (row.status !== 'upcoming') return '';
		const days = row.daysUntil ?? 0;
		return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;
	}
</script>

<section>
	<div class="mb-3 flex items-baseline gap-2">
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
		<div class="flex flex-col gap-3">
			{#each shown as day (day.date)}
				<div>
					<div class="mb-1 flex items-baseline gap-2">
						<span class="text-xs font-medium {day.date === today ? '' : 'text-muted-foreground'}">
							{dayLabel(day.date)}
						</span>
						{#if day.date < today}
							<span class="text-[11px] text-muted-foreground">
								{relativeDay(day.date, today)}
							</span>
						{/if}
					</div>

					<ol class="flex flex-col">
						{#each day.rows as row (row.id)}
							<li class="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-accent/40">
								<StatusMark status={row.status} gap={row.gap} />
								<span class="min-w-0 flex-1 truncate text-sm">{row.showTitle}</span>
								<span class="tabular shrink-0 text-xs text-muted-foreground">
									S{String(row.season).padStart(2, '0')}{compress(row.episodes)}
								</span>
								{#if whenLabel(row)}
									<span
										class="shrink-0 text-xs {row.status === 'missing'
											? 'font-medium'
											: 'text-muted-foreground'}"
									>
										{whenLabel(row)}
									</span>
								{/if}
							</li>
						{/each}
					</ol>
				</div>
			{/each}
		</div>

		<p class="tabular mt-3 text-xs text-muted-foreground">
			{counts.missing} missing · {counts.held} here · {counts.upcoming} landing
			{#if totalRows > shown.reduce((sum, day) => sum + day.rows.length, 0)}
				· earlier on the schedule
			{/if}
		</p>
	{/if}
</section>
