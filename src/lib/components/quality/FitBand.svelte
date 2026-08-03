<script lang="ts">
	import { formatBytes } from './format';
	import type { FitReport, FitVerdict } from '$lib/server/queries/quality';

	let { fit }: { fit: FitReport } = $props();

	const LABELS: Record<FitVerdict, { title: string; blurb: string; color: string }> = {
		overkill: {
			title: 'Overkill',
			blurb: 'bigger than the quality needs — re-encode candidates',
			color: 'var(--hole)'
		},
		good: {
			title: 'About right',
			blurb: 'in the band you want the library to sit in',
			color: 'var(--held)'
		},
		starved: {
			title: 'Starved',
			blurb: 'too thin for the resolution — upgrade candidates',
			color: 'var(--type-movie)'
		}
	};

	const share = (items: number) => (fit.scored > 0 ? (items / fit.scored) * 100 : 0);
	const bucket = (verdict: FitVerdict) => fit.buckets.find((b) => b.verdict === verdict);
	const goodShare = $derived(share(bucket('good')?.items ?? 0));
</script>

<section class="rounded-xl border p-4 sm:p-5">
	<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
		<h2 class="text-sm font-medium">Is the size right for the quality?</h2>
		<span class="tabular text-xs text-muted-foreground">
			{goodShare.toFixed(0)}% in band
		</span>
	</div>
	<p class="mb-4 max-w-2xl text-xs text-muted-foreground">
		Bitrate normalised for resolution and codec, so a 4K HEVC file and a 720p H.264 one are judged
		on the same scale. The band is {(fit.bands.low / 1000).toFixed(1)}–{(
			fit.bands.high / 1000
		).toFixed(1)} Mbps per megapixel of H.264-equivalent — wide on purpose, to catch files that are clearly
		wrong rather than to second-guess every encode.
	</p>

	{#if fit.scored === 0}
		<p class="text-xs text-muted-foreground">
			Nothing has both a bitrate and dimensions on record yet.
		</p>
	{:else}
		<div class="mb-3 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
			{#each fit.buckets as entry (entry.verdict)}
				{#if entry.items > 0}
					<div
						style="width: {share(entry.items)}%; background-color: {LABELS[entry.verdict].color}"
						title="{LABELS[entry.verdict].title}: {entry.items.toLocaleString()}"
					></div>
				{/if}
			{/each}
		</div>

		<div class="grid gap-3 sm:grid-cols-3">
			{#each fit.buckets as entry (entry.verdict)}
				<div class="rounded-lg bg-muted/40 p-3">
					<div class="flex items-center gap-1.5">
						<span
							class="size-2 rounded-full"
							style="background-color: {LABELS[entry.verdict].color}"
							aria-hidden="true"
						></span>
						<span class="text-xs font-medium">{LABELS[entry.verdict].title}</span>
					</div>
					<div class="tabular mt-1 text-lg font-semibold">
						{entry.items.toLocaleString()}
						<span class="text-xs font-normal text-muted-foreground">
							· {formatBytes(entry.bytes)}
						</span>
					</div>
					<div class="mt-0.5 text-[11px] text-muted-foreground">{LABELS[entry.verdict].blurb}</div>
				</div>
			{/each}
		</div>

		{#if fit.unscored > 0}
			<p class="mt-3 text-[11px] text-muted-foreground">
				{fit.unscored.toLocaleString()} video items have no bitrate or dimensions recorded and aren't
				judged either way.
			</p>
		{/if}
	{/if}
</section>
