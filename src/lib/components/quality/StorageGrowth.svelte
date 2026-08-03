<script lang="ts">
	import { formatBytes, formatMonth, sectionColor } from './format';
	import type { QualityMonth, SectionQuality } from '$lib/server/queries/quality';

	interface Props {
		months: QualityMonth[];
		sections: SectionQuality[];
		sectionLabels: Record<string, string>;
		totalBytes: number;
	}

	let { months, sections, sectionLabels, totalBytes }: Props = $props();

	const COLUMN = 11;
	const GAP = 2;
	const BARS = 88;
	const AREA = 44;

	// Ordered by size so the biggest library is the bottom of every stack and the
	// legend reads in the same order as the colours do.
	const palette = $derived(
		Object.fromEntries(sections.map((section, index) => [section.id, sectionColor(index)]))
	);

	// Leading empty months are dropped. Plex hands back the odd item stamped 1970,
	// and one of those would otherwise stretch the axis across fifty years of
	// nothing to reach the part anyone wants to look at.
	const span = $derived.by(() => {
		let first = 0;
		while (first < months.length - 1 && months[first].items === 0) first++;
		return months.slice(first);
	});

	const peak = $derived(span.reduce((max, month) => Math.max(max, month.bytes), 0));

	const columns = $derived(
		span.map((month) => ({
			month: month.month,
			bytes: month.bytes,
			cumulative: month.cumulativeBytes,
			stack: sections
				.map((section) => ({ id: section.id, bytes: month.bySection[section.id] ?? 0 }))
				.filter((slice) => slice.bytes > 0)
		}))
	);

	/**
	 * The cumulative curve, as a filled area.
	 *
	 * Drawn in a `preserveAspectRatio="none"` viewBox so it stretches to whatever
	 * width the month columns end up occupying — the alternative, measuring the
	 * scroller and recomputing on resize, buys nothing at this size. The stroke
	 * opts out of that scaling so it stays one pixel wide rather than smearing.
	 */
	const curve = $derived.by(() => {
		const total = columns.at(-1)?.cumulative ?? 0;
		if (columns.length < 2 || total === 0) return null;

		const step = 100 / (columns.length - 1);
		const points = columns.map(
			(column, index) => `${index * step},${100 - (column.cumulative / total) * 100}`
		);

		return { line: `M${points.join('L')}`, area: `M0,100L${points.join('L')}L100,100Z` };
	});
</script>

<section class="rounded-xl border p-4 sm:p-5">
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h2 class="text-sm font-medium">Storage growth</h2>
		<p class="tabular text-xs text-muted-foreground">{formatBytes(totalBytes)} in total</p>
	</div>

	{#if columns.length === 0 || totalBytes === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">No file sizes recorded yet.</p>
	{:else}
		<div class="mt-4 flex gap-3">
			<div
				class="flex shrink-0 flex-col justify-between text-[10px] leading-none text-muted-foreground"
				style="height: {BARS}px"
				aria-hidden="true"
			>
				<span>{formatBytes(peak)}</span>
				<span>0</span>
			</div>

			<div class="min-w-0 flex-1 overflow-x-auto pb-1">
				<div class="w-max">
					{#if curve}
						<svg
							viewBox="0 0 100 100"
							preserveAspectRatio="none"
							class="mb-1.5 block text-muted-foreground"
							style="width: {columns.length * (COLUMN + GAP) - GAP}px; height: {AREA}px"
							role="img"
							aria-label="Cumulative library size, {formatBytes(totalBytes)} in total"
						>
							<path d={curve.area} fill="currentColor" fill-opacity="0.15" />
							<path
								d={curve.line}
								fill="none"
								stroke="currentColor"
								stroke-width="1.25"
								vector-effect="non-scaling-stroke"
							/>
						</svg>
					{/if}

					<div class="flex items-end" style="height: {BARS}px; gap: {GAP}px">
						{#each columns as column (column.month)}
							<div
								class="flex flex-col-reverse"
								style="width: {COLUMN}px; height: {peak > 0
									? Math.max((column.bytes / peak) * BARS, column.bytes > 0 ? 2 : 0)
									: 0}px"
								title="{formatMonth(column.month)} · +{formatBytes(column.bytes)} · {formatBytes(
									column.cumulative
								)} total"
							>
								{#each column.stack as slice (slice.id)}
									<div
										style="height: {(slice.bytes / column.bytes) *
											100}%; background-color: {palette[slice.id]}"
									></div>
								{/each}
							</div>
						{/each}
					</div>

					<div class="mt-1 flex" style="gap: {GAP}px">
						{#each columns as column, index (column.month)}
							<div
								class="tabular relative text-[10px] leading-4 text-muted-foreground"
								style="width: {COLUMN}px"
							>
								{#if index === 0 || column.month.slice(5, 7) === '01'}
									<span class="absolute left-0 whitespace-nowrap">{column.month.slice(0, 4)}</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
			{#each sections as section (section.id)}
				{#if section.bytes > 0}
					<li class="flex items-center gap-1.5">
						<span
							class="size-2 rounded-full"
							style="background-color: {palette[section.id]}"
							aria-hidden="true"
						></span>
						<span>{sectionLabels[section.id] ?? section.id}</span>
						<span class="tabular font-medium text-foreground">{formatBytes(section.bytes)}</span>
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
</section>
