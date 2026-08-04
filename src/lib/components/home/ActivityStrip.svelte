<script lang="ts">
	import { resolve } from '$app/paths';
	import { addDays, todayKey, weekdayOf, WEEKDAY_LABELS, formatDayLong } from '$lib/activity/dates';
	import { cellColor, type HeatmapDay } from '$lib/activity/heatmap';

	interface Props {
		days: HeatmapDay[];
		timeZone: string;
		weeks?: number;
	}

	let { days, timeZone, weeks = 12 }: Props = $props();

	/**
	 * A short, fixed-width slice of the full calendar.
	 *
	 * Reuses the calendar's own colour ramp rather than a second scale, so a busy
	 * day looks the same shade here as it does on the Activity page — two
	 * different ramps for the same data would read as a discrepancy.
	 */
	const grid = $derived.by(() => {
		const today = todayKey(timeZone);
		const counts = new Map(days.map((day) => [day.date, day]));

		// Start on the Sunday that begins the earliest week shown, so the rows are
		// weekdays and the columns are weeks.
		const start = addDays(today, -(weeks * 7 - 1 + weekdayOf(addDays(today, -(weeks * 7 - 1)))));

		const columns: { key: string; cells: (HeatmapDay & { future: boolean })[] }[] = [];
		for (let week = 0; week < weeks; week++) {
			const cells = [];
			for (let day = 0; day < 7; day++) {
				const date = addDays(start, week * 7 + day);
				const found = counts.get(date);
				cells.push({
					date,
					count: found?.count ?? 0,
					byType: found?.byType ?? { movie: 0, episode: 0, track: 0, other: 0 },
					future: date > today
				});
			}
			columns.push({ key: addDays(start, week * 7), cells });
		}
		return columns;
	});

	const max = $derived(Math.max(1, ...days.map((day) => day.count)));

	function level(count: number): number {
		if (count <= 0) return 0;
		const ratio = count / max;
		return ratio > 0.6 ? 4 : ratio > 0.3 ? 3 : ratio > 0.1 ? 2 : 1;
	}

	function dominant(cell: HeatmapDay) {
		let best: keyof HeatmapDay['byType'] | null = null;
		let bestCount = 0;
		for (const [type, count] of Object.entries(cell.byType) as [
			keyof HeatmapDay['byType'],
			number
		][]) {
			if (count > bestCount) {
				best = type;
				bestCount = count;
			}
		}
		return best;
	}
</script>

<section>
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<h2 class="text-sm font-medium">Activity</h2>
		<a
			href={resolve('/activity')}
			class="text-xs text-muted-foreground underline-offset-4 hover:underline"
		>
			full calendar →
		</a>
	</div>

	<div class="flex gap-2">
		<div
			class="flex shrink-0 flex-col gap-[3px] pt-0 text-[9px] leading-none text-muted-foreground"
			aria-hidden="true"
		>
			{#each WEEKDAY_LABELS as label, index (label)}
				<div class="flex h-[11px] items-center">{index % 2 === 1 ? label[0] : ''}</div>
			{/each}
		</div>

		<div class="flex gap-[3px] overflow-hidden">
			{#each grid as column (column.key)}
				<div class="flex flex-col gap-[3px]">
					{#each column.cells as cell (cell.date)}
						<div
							class="size-[11px] rounded-[2px]"
							style="background-color: {cell.future
								? 'transparent'
								: cellColor({
										date: cell.date,
										count: cell.count,
										byType: cell.byType,
										level: level(cell.count),
										dominantType: dominant(cell),
										filler: false
									})}"
							title="{formatDayLong(cell.date)}: {cell.count}"
						></div>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</section>
