<script lang="ts">
	import { TIER_LABELS, formatBitrate, formatBytes, formatShare, rampColor } from './format';
	import type { QualityOverview, SectionQuality } from '$lib/server/queries/quality';

	interface Props {
		tiers: QualityOverview['tiers'];
		unranked: number;
		sections: SectionQuality[];
		sectionLabels: Record<string, string>;
	}

	let { tiers, unranked, sections, sectionLabels }: Props = $props();

	const ranked = $derived(tiers.reduce((sum, tier) => sum + tier.count, 0));

	const colors = $derived(
		Object.fromEntries(tiers.map((tier, index) => [tier.key, rampColor(index, tiers.length)]))
	);

	// Only libraries big enough to rank appear in the thresholds table — the rest
	// have no percentiles to show, and a row of dashes invites the reader to work
	// out why rather than saying it once, below.
	const rankedSections = $derived(sections.filter((section) => section.ranked));
</script>

<section class="rounded-xl border bg-card/50 p-4 sm:p-5">
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h2 class="text-sm font-medium">Quality tiers</h2>
		<p class="text-xs text-muted-foreground">
			Ranked by bitrate against the rest of its own library
		</p>
	</div>

	{#if ranked === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">
			No library here has enough rated items to rank.
		</p>
	{:else}
		<div class="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
			{#each tiers as tier (tier.key)}
				{#if tier.count > 0}
					<div
						class="h-full"
						style="width: {(tier.count / ranked) * 100}%; background-color: {colors[tier.key]}"
					></div>
				{/if}
			{/each}
		</div>

		<dl class="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
			{#each tiers as tier (tier.key)}
				<div class="flex items-baseline gap-2 text-xs">
					<dt class="flex items-center gap-2 text-muted-foreground">
						<span
							class="size-2.5 shrink-0 rounded-[3px]"
							style="background-color: {colors[tier.key]}"
							aria-hidden="true"
						></span>
						{TIER_LABELS[tier.key]}
					</dt>
					<dd class="tabular ml-auto flex items-baseline gap-3">
						<span class="font-medium">{tier.count.toLocaleString()}</span>
						<span class="w-9 text-right text-muted-foreground"
							>{formatShare(tier.count, ranked)}</span
						>
						<span class="w-16 text-right text-muted-foreground">{formatBytes(tier.bytes)}</span>
					</dd>
				</div>
			{/each}
		</dl>

		{#if rankedSections.length > 0}
			<!-- The thresholds are what stop the percentiles being circular. "Top 10%"
			     means nothing until you can see that it starts at 18 Mbps in Movies
			     and at 240 kbps in Music. -->
			<div class="mt-5 overflow-x-auto">
				<table class="w-full min-w-[26rem] text-xs">
					<thead class="text-muted-foreground">
						<tr class="border-b">
							<th class="py-1.5 pr-3 text-left font-normal">Library</th>
							<th class="py-1.5 pr-3 text-right font-normal">Rated</th>
							<th class="py-1.5 pr-3 text-right font-normal">Bottom 25% under</th>
							<th class="py-1.5 pr-3 text-right font-normal">Median</th>
							<th class="py-1.5 text-right font-normal">Top 10% over</th>
						</tr>
					</thead>
					<tbody>
						{#each rankedSections as section (section.id)}
							<tr class="border-b border-border/50 last:border-0">
								<td class="truncate py-1.5 pr-3">{sectionLabels[section.id] ?? section.id}</td>
								<td class="tabular py-1.5 pr-3 text-right text-muted-foreground">
									{section.rated.toLocaleString()}
								</td>
								<td class="tabular py-1.5 pr-3 text-right text-muted-foreground">
									{formatBitrate(section.p25)}
								</td>
								<td class="tabular py-1.5 pr-3 text-right">{formatBitrate(section.p50)}</td>
								<td class="tabular py-1.5 text-right text-muted-foreground">
									{formatBitrate(section.p90)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if unranked > 0}
			<p class="mt-3 text-[11px] text-muted-foreground">
				{unranked.toLocaleString()}
				{unranked === 1 ? 'item sits' : 'items sit'} in libraries with fewer than 10 rated files, where
				a percentile would only be describing its neighbours.
			</p>
		{/if}
	{/if}
</section>
