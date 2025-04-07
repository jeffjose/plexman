<script lang="ts">
	import { onMount, afterUpdate } from 'svelte';

	export let item: any;
	export let detailedMedia: Map<string, any>;
	export let onDebug: (movie: any) => Promise<void>;
	export let formatDuration: (ms: number) => string;
	export let formatFileSize: (bytes: number) => string;
	export let getPercentiles: (
		size: number,
		overallBitrate: number
	) => {
		sizePercentile: number;
		overallBitratePercentile: number;
	};

	let rowElement: HTMLElement;
	let observer: IntersectionObserver | null = null;
	let expanded = false;

	function setupObserver() {
		if (observer) {
			observer.disconnect();
		}

		observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting && !detailedMedia.has(item.ratingKey)) {
						onDebug(item);
						observer?.unobserve(entry.target);
					}
				});
			},
			{ threshold: 0.1 }
		);

		if (rowElement && !detailedMedia.has(item.ratingKey)) {
			observer.observe(rowElement);
		}
	}

	onMount(() => {
		setupObserver();
		return () => {
			if (observer) {
				observer.disconnect();
			}
		};
	});

	afterUpdate(() => {
		setupObserver();
	});

	function getVideoCodec(mediaItem: any) {
		const videoStream = mediaItem?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 1);
		return videoStream?.codec?.toUpperCase() || 'Unknown';
	}

	function getAudioCodec(mediaItem: any) {
		const audioStream = mediaItem?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 2);
		return audioStream?.codec?.toUpperCase() || 'Unknown';
	}

	function getResolution(mediaItem: any) {
		const videoStream = mediaItem?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 1);
		if (!videoStream) return '';
		return `${videoStream.width}x${videoStream.height}`;
	}

	function getBitrate(mediaItem: any, streamType: number) {
		const stream = mediaItem?.Part?.[0]?.Stream?.find((s: any) => s.streamType === streamType);
		return stream?.bitrate || mediaItem?.bitrate || 0;
	}

	function getPercentileColor(percentile: number): string {
		if (percentile < 25) return 'text-red-500';
		if (percentile < 50) return 'text-orange-500';
		if (percentile > 75) return 'text-green-500';
		return 'text-teal-500';
	}

	$: detailedItem = detailedMedia.get(item.ratingKey);
	$: mediaVersions = detailedItem?.Media || item.Media || [];
	$: hasMultipleVersions = mediaVersions.length > 1;
</script>

<tr
	bind:this={rowElement}
	class="group hover:bg-gray-50 {hasMultipleVersions ? 'border-l-2 border-orange-400' : ''}"
>
	<td class="px-1 py-1">
		<img
			src={`${localStorage.getItem('plexServerUrl')}${item.thumb}?X-Plex-Token=${localStorage.getItem('plexToken')}`}
			alt={item.title}
			class="w-12 h-16 object-cover rounded"
			loading="lazy"
			decoding="async"
		/>
	</td>
	<td class="px-2 py-1">
		<div class="flex items-center space-x-2">
			{#if item.Media?.[0]?.bitrate}
				{@const percentiles = getPercentiles(
					item.Media[0].Part?.[0]?.size || 0,
					item.Media[0].bitrate
				)}
				<div class="flex space-x-0.5" title="{percentiles.overallBitratePercentile}th percentile">
					<div
						class="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-opacity-30 {percentiles.overallBitratePercentile >=
						75
							? 'bg-green-500 ring-green-200'
							: percentiles.overallBitratePercentile >= 50
								? 'bg-teal-500 ring-teal-200'
								: percentiles.overallBitratePercentile >= 25
									? 'bg-orange-500 ring-orange-200'
									: 'bg-red-500 ring-red-200'}"
					></div>
					<div
						class="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-opacity-30 {percentiles.overallBitratePercentile >=
						75
							? 'bg-green-500 ring-green-200'
							: percentiles.overallBitratePercentile >= 50
								? 'bg-teal-500 ring-teal-200'
								: percentiles.overallBitratePercentile >= 25
									? 'bg-orange-500 ring-orange-200'
									: 'bg-gray-200 ring-gray-100'}"
					></div>
					<div
						class="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-opacity-30 {percentiles.overallBitratePercentile >=
						75
							? 'bg-green-500 ring-green-200'
							: percentiles.overallBitratePercentile >= 50
								? 'bg-teal-500 ring-teal-200'
								: 'bg-gray-200 ring-gray-100'}"
					></div>
					<div
						class="w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-opacity-30 {percentiles.overallBitratePercentile >=
						75
							? 'bg-green-500 ring-green-200'
							: 'bg-gray-200 ring-gray-100'}"
					></div>
				</div>
			{/if}
			<div>
				<div class="font-medium text-sm text-gray-900">{item.title}</div>
				{#if item.originalTitle && item.originalTitle !== item.title}
					<div class="text-xs text-gray-500">{item.originalTitle}</div>
				{/if}
			</div>
		</div>
	</td>
	<td class="px-2 py-1 text-xs text-gray-500">{item.year}</td>
	<td class="px-2 py-1 text-xs text-gray-500">{formatDuration(item.duration)}</td>
	<td class="px-2 py-1">
		<div class="space-y-1">
			{#each mediaVersions as mediaItem, i}
				{@const size = mediaItem?.Part?.[0]?.size || 0}
				{@const overallBitrate = getBitrate(mediaItem, 0)}
				{@const videoBitrate = getBitrate(mediaItem, 1)}
				{@const percentiles = getPercentiles(size, overallBitrate)}
				<div
					class="flex items-center space-x-2 {i > 0 ? 'mt-1 pt-1 border-t border-gray-100' : ''}"
				>
					<div class="text-xs w-14 {getPercentileColor(percentiles.sizePercentile)}">
						{formatFileSize(size)}
						<span class="opacity-75">({percentiles.sizePercentile}p)</span>
					</div>
					<div class="flex space-x-1">
						<span
							class="px-1.5 py-0.5 text-xs font-medium rounded {getVideoCodec(mediaItem) === 'HEVC'
								? 'bg-green-100 text-green-800'
								: 'bg-blue-100 text-blue-800'}"
						>
							{getVideoCodec(mediaItem)}
						</span>
						<span class="px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-800 rounded">
							{getResolution(mediaItem)}
						</span>
					</div>
					<div class="text-xs w-14 {getPercentileColor(percentiles.overallBitratePercentile)}">
						{overallBitrate}k
						<span class="opacity-75">({percentiles.overallBitratePercentile}p)</span>
					</div>
					<div class="text-xs text-gray-500 w-14">
						{videoBitrate}k
					</div>
					<div class="text-xs text-gray-500 w-14">{getBitrate(mediaItem, 2)}k</div>
				</div>
			{/each}
		</div>
	</td>
</tr>
