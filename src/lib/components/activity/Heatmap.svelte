<script lang="ts">
	import {
		buildHeatmap,
		cellColor,
		type HeatmapCell,
		type HeatmapDay
	} from '$lib/activity/heatmap';
	import { addDays, formatDayLong, todayKey, WEEKDAY_LABELS } from '$lib/activity/dates';
	import { TYPE_LABELS, type MediaType } from '$lib/activity/types';

	interface Props {
		days: HeatmapDay[];
		timeZone: string;
		selected: string | null;
		onselect: (date: string | null) => void;
	}

	let { days, timeZone, selected, onselect }: Props = $props();

	const today = $derived(todayKey(timeZone));

	// The range always ends today so the chart reads as "up to now" even after a
	// quiet spell, and starts a year back at minimum so a new account doesn't get
	// a two-column grid.
	const range = $derived.by(() => {
		const earliest = days[0]?.date;
		const from = earliest && earliest < addDays(today, -364) ? earliest : addDays(today, -364);
		return { from, to: today };
	});

	const grid = $derived(buildHeatmap(days, range.from, range.to));

	let scroller = $state<HTMLDivElement | null>(null);
	let hovered = $state<HeatmapCell | null>(null);
	let tooltipStyle = $state('');

	const CELL = 13;
	const GAP = 3;
	const COLUMN = CELL + GAP;

	/**
	 * Open scrolled to the right-hand (most recent) end.
	 *
	 * Written as a one-shot effect keyed on the element: re-running it on every
	 * grid change would yank the view back to today while the user is reading
	 * 2019.
	 */
	let hasScrolled = $state(false);
	$effect(() => {
		if (!scroller || hasScrolled) return;
		scroller.scrollLeft = scroller.scrollWidth;
		hasScrolled = true;
	});

	// Takes both mouse and focus events so hovering and keyboard-focusing a cell
	// surface the same tooltip.
	function showTooltip(event: MouseEvent | FocusEvent, cell: HeatmapCell) {
		if (cell.filler) return;
		hovered = cell;

		const target = event.currentTarget as HTMLElement;
		const bounds = target.getBoundingClientRect();
		// Positioned against the viewport rather than the scroller so the tooltip
		// isn't clipped by the scroll container's overflow.
		tooltipStyle = `left: ${bounds.left + bounds.width / 2}px; top: ${bounds.top - 8}px;`;
	}

	function jumpToYear(year: number) {
		const weekIndex = grid.yearOffsets.get(year);
		if (weekIndex === undefined || !scroller) return;
		scroller.scrollTo({ left: Math.max(0, weekIndex * COLUMN - 40), behavior: 'smooth' });
	}

	function toggle(cell: HeatmapCell) {
		if (cell.filler) return;
		onselect(selected === cell.date ? null : cell.date);
	}

	/**
	 * Arrow-key navigation across the grid.
	 *
	 * Cells are buttons in DOM order (column by column), so left/right is ±7 and
	 * up/down is ±1 — the visual axes are transposed relative to the DOM.
	 */
	function onKeydown(event: KeyboardEvent, weekIndex: number, dayIndex: number) {
		const deltas: Record<string, [number, number]> = {
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
			ArrowUp: [0, -1],
			ArrowDown: [0, 1]
		};
		const delta = deltas[event.key];
		if (!delta) return;

		event.preventDefault();
		const nextWeek = weekIndex + delta[0];
		const nextDay = dayIndex + delta[1];
		if (nextWeek < 0 || nextWeek >= grid.weeks.length || nextDay < 0 || nextDay > 6) return;

		const next = scroller?.querySelector<HTMLButtonElement>(`[data-cell="${nextWeek}-${nextDay}"]`);
		next?.focus();
		next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	function breakdown(cell: HeatmapCell): [MediaType, number][] {
		return (Object.entries(cell.byType) as [MediaType, number][])
			.filter(([, count]) => count > 0)
			.sort((a, b) => b[1] - a[1]);
	}
</script>

<div class="relative">
	{#if grid.yearOffsets.size > 1}
		<div class="mb-3 flex flex-wrap gap-1">
			{#each [...grid.yearOffsets.keys()].sort((a, b) => b - a) as year (year)}
				<button
					type="button"
					onclick={() => jumpToYear(year)}
					class="tabular rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
				>
					{year}
				</button>
			{/each}
		</div>
	{/if}

	<div class="flex gap-2">
		<!-- Weekday gutter. Only alternate rows are labelled; seven labels at this
		     cell size collide. -->
		<div
			class="flex shrink-0 flex-col pt-[19px] text-[10px] leading-none text-muted-foreground"
			style="gap: {GAP}px"
			aria-hidden="true"
		>
			{#each WEEKDAY_LABELS as label, index (label)}
				<div class="flex items-center" style="height: {CELL}px">
					{index % 2 === 1 ? label : ''}
				</div>
			{/each}
		</div>

		<div
			bind:this={scroller}
			class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-2"
			role="group"
			aria-label="Watch activity calendar"
			onmouseleave={() => (hovered = null)}
		>
			<div class="relative w-max">
				<!-- Month labels, absolutely positioned so they can't disturb the
				     column rhythm below them. -->
				<div class="relative mb-1 h-4 text-[10px] leading-4 text-muted-foreground">
					{#each grid.months as month (month.label + month.year + month.weekIndex)}
						<span class="absolute whitespace-nowrap" style="left: {month.weekIndex * COLUMN}px">
							{month.label}{month.isYearStart ? ` ’${String(month.year).slice(2)}` : ''}
						</span>
					{/each}
				</div>

				<div class="flex" style="gap: {GAP}px">
					{#each grid.weeks as week, weekIndex (week.key)}
						<div class="flex flex-col" style="gap: {GAP}px">
							{#each week.cells as cell, dayIndex (cell.date)}
								{#if cell.filler}
									<div style="width: {CELL}px; height: {CELL}px"></div>
								{:else}
									<button
										type="button"
										data-cell="{weekIndex}-{dayIndex}"
										class="rounded-[3px] outline-2 outline-offset-1 outline-transparent transition-[outline-color,transform] hover:outline-foreground/40 focus-visible:outline-ring {selected ===
										cell.date
											? 'outline-foreground'
											: ''}"
										style="width: {CELL}px; height: {CELL}px; background-color: {cellColor(cell)}"
										aria-label="{formatDayLong(cell.date)}: {cell.count} {cell.count === 1
											? 'item'
											: 'items'}"
										aria-pressed={selected === cell.date}
										onmouseenter={(event) => showTooltip(event, cell)}
										onfocus={(event) => showTooltip(event, cell)}
										onclick={() => toggle(cell)}
										onkeydown={(event) => onKeydown(event, weekIndex, dayIndex)}
									></button>
								{/if}
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<div class="mt-3 flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			{#each Object.entries(TYPE_LABELS) as [type, label] (type)}
				<span class="flex items-center gap-1.5">
					<span
						class="size-2.5 rounded-[2px]"
						style="background-color: var(--type-{type})"
						aria-hidden="true"
					></span>
					{label}
				</span>
			{/each}
		</div>

		<div class="flex shrink-0 items-center gap-1.5">
			<span>Less</span>
			{#each [0, 1, 2, 3, 4] as level (level)}
				<span
					class="size-2.5 rounded-[2px]"
					style="background-color: {cellColor({
						date: '',
						count: level,
						byType: { movie: 0, episode: 0, track: 0, other: 0 },
						level,
						dominantType: null,
						filler: false
					})}"
					aria-hidden="true"
				></span>
			{/each}
			<span>More</span>
		</div>
	</div>

	{#if hovered}
		<!-- `fixed` + a viewport-relative position keeps the tooltip above the
		     scroller's overflow clipping. -->
		<div
			class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
			style={tooltipStyle}
			role="tooltip"
		>
			<div class="font-medium">{formatDayLong(hovered.date)}</div>
			{#if hovered.count === 0}
				<div class="mt-0.5 text-muted-foreground">Nothing watched</div>
			{:else}
				<div class="tabular mt-0.5">
					{hovered.count}
					{hovered.count === 1 ? 'item' : 'items'}
				</div>
				<div class="mt-1.5 flex flex-col gap-0.5">
					{#each breakdown(hovered) as [type, count] (type)}
						<div class="flex items-center gap-1.5">
							<span
								class="size-2 rounded-[2px]"
								style="background-color: var(--type-{type})"
								aria-hidden="true"
							></span>
							<span class="text-muted-foreground">{TYPE_LABELS[type]}</span>
							<span class="tabular ml-auto pl-3">{count}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
