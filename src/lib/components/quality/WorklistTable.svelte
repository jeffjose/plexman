<script lang="ts">
	import { formatBitrate, formatBytes } from './format';
	import type { QualityItem } from '$lib/server/queries/quality';

	interface Props {
		title: string;
		description: string;
		/** The caveat on the saving column. Always shown — every number in this
		 *  column is a projection, and a projection presented bare gets quoted back
		 *  as a fact. */
		caveat: string;
		items: QualityItem[];
		sectionLabels: Record<string, string>;
		kind: 'reencode' | 'duplicate';
		emptyMessage: string;
	}

	let { title, description, caveat, items, sectionLabels, kind, emptyMessage }: Props = $props();

	const totalSaving = $derived(items.reduce((sum, item) => sum + item.savingBytes, 0));

	function detail(item: QualityItem): string {
		if (kind === 'duplicate') {
			return `${item.versionCount} versions`;
		}
		const parts = [item.videoResolution?.toUpperCase() ?? 'unknown'];
		if (item.bitrate) parts.push(formatBitrate(item.bitrate));
		return parts.join(' · ');
	}
</script>

<section class="rounded-xl border p-4 sm:p-5">
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h2 class="text-sm font-medium">{title}</h2>
		<p class="text-xs text-muted-foreground">{description}</p>
	</div>

	{#if items.length === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
	{:else}
		<ol class="mt-3 flex flex-col">
			{#each items as item (item.id)}
				<li
					class="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40"
				>
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm">{item.title}</div>
						<div class="truncate text-xs text-muted-foreground">
							{sectionLabels[item.sectionId] ?? item.sectionId}
							{#if item.subtitle}
								<span class="px-1">·</span>{item.subtitle}
							{/if}
							<span class="px-1">·</span><span class="tabular">{detail(item)}</span>
						</div>
					</div>

					<div class="shrink-0 text-right">
						<div class="tabular text-sm">{formatBytes(item.fileSize)}</div>
						<div class="tabular text-[11px] text-muted-foreground">
							~{formatBytes(item.savingBytes)} back
						</div>
					</div>
				</li>
			{/each}
		</ol>

		<p class="mt-3 border-t pt-3 text-[11px] text-muted-foreground">
			<span class="tabular text-foreground">~{formatBytes(totalSaving)}</span>
			across these {items.length}. {caveat}
		</p>
	{/if}
</section>
