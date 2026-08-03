<script lang="ts">
	import { CODEC_GROUPS, CODEC_LABELS, formatBitrate, formatMonth } from './format';
	import type { QualityMonth } from '$lib/server/queries/quality';

	interface Props {
		months: QualityMonth[];
	}

	let { months }: Props = $props();

	const COLUMN = 11;
	const GAP = 2;
	const HEIGHT = 88;

	/** Hue is meaningful here — a codec is a different thing, not more of the same
	 *  thing — so these key off the media-type tokens rather than the tier ramp.
	 *  H.264 takes the warning-ish gold because it's the one you'd act on. */
	const CODEC_COLORS: Record<string, string> = {
		hevc: 'var(--type-movie)',
		h264: 'var(--type-episode)',
		other: 'var(--type-other)'
	};

	// Trailing empty months are dropped rather than drawn: they're the gap between
	// the last thing added and today, which the page says elsewhere and which
	// would otherwise eat half the chart's width.
	const span = $derived.by(() => {
		if (months.length === 0) return months;

		let last = months.length - 1;
		while (last > 0 && months[last].videoItems === 0) last--;
		let first = 0;
		while (first < last && months[first].videoItems === 0) first++;
		return months.slice(first, last + 1);
	});

	const peak = $derived(span.reduce((max, month) => Math.max(max, month.medianBitrate ?? 0), 0));

	const columns = $derived(
		span.map((month) => {
			const coded = CODEC_GROUPS.reduce((sum, group) => sum + month.codecs[group], 0);
			return {
				month: month.month,
				median: month.medianBitrate,
				height: peak > 0 && month.medianBitrate ? (month.medianBitrate / peak) * HEIGHT : 0,
				coded,
				shares: CODEC_GROUPS.map((group) => ({
					group,
					count: month.codecs[group],
					share: coded > 0 ? (month.codecs[group] / coded) * 100 : 0
				}))
			};
		})
	);

	function yearLabel(month: string, index: number): string | null {
		if (index === 0 || month.slice(5, 7) === '01') return month.slice(0, 4);
		return null;
	}

	function tooltip(column: (typeof columns)[number]): string {
		const parts = [formatMonth(column.month)];
		parts.push(column.median ? `median ${formatBitrate(column.median)}` : 'no video added');
		for (const share of column.shares) {
			if (share.count > 0) {
				parts.push(`${CODEC_LABELS[share.group]} ${Math.round(share.share)}%`);
			}
		}
		return parts.join(' · ');
	}
</script>

<section class="rounded-xl border p-4 sm:p-5">
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h2 class="text-sm font-medium">Quality over time</h2>
		<p class="text-xs text-muted-foreground">
			Median bitrate and codec of the video added each month
		</p>
	</div>

	{#if columns.length === 0 || peak === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">No video items with a bitrate yet.</p>
	{:else}
		<div class="mt-4 flex gap-3">
			<!-- Axis on the left rather than gridlines: two labels are enough to read
			     the bars against, and gridlines behind bars this thin turn to mush. -->
			<div
				class="flex shrink-0 flex-col justify-between text-[10px] leading-none text-muted-foreground"
				style="height: {HEIGHT}px"
				aria-hidden="true"
			>
				<span>{formatBitrate(peak)}</span>
				<span>0</span>
			</div>

			<div class="min-w-0 flex-1 overflow-x-auto pb-1">
				<div class="w-max">
					<div class="flex items-end" style="height: {HEIGHT}px; gap: {GAP}px">
						{#each columns as column (column.month)}
							<div
								class="rounded-t-[2px] bg-foreground/70 transition-colors hover:bg-foreground"
								style="width: {COLUMN}px; height: {Math.max(
									column.height,
									column.median ? 2 : 0
								)}px"
								title={tooltip(column)}
							></div>
						{/each}
					</div>

					<!-- Codec share sits directly beneath the bitrate bars on the same
					     axis: the interesting reading is the two together — the month the
					     stack turned blue is usually the month the medians jumped. -->
					<div class="mt-1.5 flex items-end" style="gap: {GAP}px">
						{#each columns as column (column.month)}
							<div
								class="flex h-4 flex-col-reverse overflow-hidden rounded-[2px] bg-muted"
								style="width: {COLUMN}px"
								title={tooltip(column)}
							>
								{#each column.shares as share (share.group)}
									{#if share.share > 0}
										<div
											style="height: {share.share}%; background-color: {CODEC_COLORS[share.group]}"
										></div>
									{/if}
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
								{#if yearLabel(column.month, index)}
									<span class="absolute left-0 whitespace-nowrap">
										{yearLabel(column.month, index)}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
			{#each CODEC_GROUPS as group (group)}
				<span class="flex items-center gap-1.5">
					<span
						class="size-2 rounded-full"
						style="background-color: {CODEC_COLORS[group]}"
						aria-hidden="true"
					></span>
					{CODEC_LABELS[group]}
				</span>
			{/each}
			<span class="ml-auto">Movies and episodes only — music has no comparable scale.</span>
		</div>
	{/if}
</section>
