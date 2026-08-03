<script lang="ts">
	import { formatBytes, formatShare, rampColor } from './format';
	import type { MixEntry } from '$lib/server/queries/quality';

	interface Props {
		resolutions: MixEntry[];
		codecs: MixEntry[];
	}

	let { resolutions, codecs }: Props = $props();

	// Long tails get folded away: a dozen one-off containers push the rows that
	// matter off the bottom of the panel and tell you nothing you'd act on.
	const TOP_N = 6;

	function fold(entries: MixEntry[]): MixEntry[] {
		if (entries.length <= TOP_N) return entries;

		const head = entries.slice(0, TOP_N - 1);
		const tail = entries.slice(TOP_N - 1);
		return [
			...head,
			{
				key: '__rest',
				label: `${tail.length} others`,
				count: tail.reduce((sum, entry) => sum + entry.count, 0),
				bytes: tail.reduce((sum, entry) => sum + entry.bytes, 0)
			}
		];
	}

	const groups = $derived([
		{ title: 'Resolution', entries: resolutions },
		{ title: 'Video codec', entries: fold(codecs) }
	]);
</script>

<section class="grid gap-4 sm:grid-cols-2">
	{#each groups as group (group.title)}
		{@const total = group.entries.reduce((sum, entry) => sum + entry.count, 0)}
		<div class="rounded-xl border bg-card/50 p-4 sm:p-5">
			<h2 class="text-sm font-medium">{group.title}</h2>

			{#if total === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">Nothing reported yet.</p>
			{:else}
				<ul class="mt-4 flex flex-col gap-2.5">
					{#each group.entries as entry, index (entry.key)}
						<li class="flex flex-col gap-1">
							<div class="flex items-baseline gap-2 text-xs">
								<span class="truncate">{entry.label}</span>
								<span class="tabular ml-auto font-medium">{entry.count.toLocaleString()}</span>
								<span class="tabular w-9 text-right text-muted-foreground">
									{formatShare(entry.count, total)}
								</span>
								<span class="tabular w-16 text-right text-muted-foreground">
									{formatBytes(entry.bytes)}
								</span>
							</div>
							<!-- Bar length is share of items; the byte figure beside it is the
							     other half of the story, and the two rarely agree — 4K is a
							     small slice of the count and most of the disk. -->
							<div class="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
								<div
									class="h-full rounded-full"
									style="width: {(entry.count / total) * 100}%; background-color: {rampColor(
										index,
										group.entries.length
									)}"
								></div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/each}
</section>
