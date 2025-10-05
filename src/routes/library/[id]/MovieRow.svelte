<script lang="ts">
	import { onMount, afterUpdate } from 'svelte';
	import { page } from '$app/stores';

	export let item: any;
	export let detailedMedia: Map<string, any>;
	export let onDebug: (item: any) => Promise<void>;
	export let formatDuration: (ms: number) => string;
	export let formatFileSize: (bytes: number) => string;
	export let allSizes: number[] = [];
	export let allOverallBitrates: number[] = [];
	export let calculatePercentileFn: (value: number, allValues: number[]) => number;

	// Access server data
	$: ({ plexToken, plexServerUrl } = $page.data);

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

<div
	bind:this={rowElement}
	class="group hover:bg-gray-50 {hasMultipleVersions ? 'border-l-2 border-orange-400' : ''} grid grid-cols-[48px_1fr_56px_80px_112px_96px] gap-2 px-2 py-1 border-b border-gray-200 items-center"
>
	<div class="px-1 py-1">
		{#if item.thumb && plexServerUrl && plexToken}
			<img
				src={`${plexServerUrl}${item.thumb}?X-Plex-Token=${plexToken}`}
				alt={item.title}
				class="w-12 h-16 object-cover rounded bg-gray-200"
				loading="lazy"
				decoding="async"
			/>
		{:else}
			<div class="w-12 h-16 rounded bg-gray-200 flex items-center justify-center">
				<svg class="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 24 24"
					><path
						d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"
					/></svg
				>
			</div>
		{/if}
	</div>
	<div class="px-2 py-1">
		<div class="flex items-center space-x-2">
			{#if item.Media?.[0]?.bitrate}
				{@const size = item.Media[0].Part?.[0]?.size || 0}
				{@const bitrate = item.Media[0].bitrate}
				{@const bitratePercentile = calculatePercentileFn(bitrate, allOverallBitrates)}
				<div class="flex -space-x-0.5" title="{bitratePercentile}th percentile">
					{#each Array(4) as _, i}
						<div class="w-3 h-3 flex items-center justify-center">
							{#if bitratePercentile >= 90}
								<svg
									class="w-3.5 h-3.5 text-green-500"
									fill="currentColor"
									viewBox="0 0 20 20"
									xmlns="http://www.w3.org/2000/svg"
								>
									<path
										d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
									/>
								</svg>
							{:else}
								<svg
									class="w-2.5 h-2.5 {bitratePercentile >= 75
										? 'text-green-500'
										: bitratePercentile >= 50
											? i <= 2
												? 'text-teal-500'
												: 'text-gray-200'
											: bitratePercentile >= 25
												? i <= 1
													? 'text-orange-500'
													: 'text-gray-200'
												: i === 0
													? 'text-red-500'
													: 'text-gray-200'}"
									fill="currentColor"
									viewBox="0 0 20 20"
									xmlns="http://www.w3.org/2000/svg"
								>
									<circle cx="10" cy="10" r="8" />
								</svg>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			<div>
				<div class="font-medium text-sm text-gray-900">{item.title}</div>
				{#if item.originalTitle && item.originalTitle !== item.title}
					<div class="text-xs text-gray-500">{item.originalTitle}</div>
				{/if}
				{#each mediaVersions as mediaItem}
					{#if mediaItem?.Part?.[0]?.file}
						<div class="text-xs text-gray-400 truncate max-w-md">
							{mediaItem.Part[0].file.split('/').pop()}
						</div>
					{/if}
				{/each}
			</div>
		</div>
	</div>
	<div class="px-2 py-1 text-xs text-gray-500">{item.year}</div>
	<div class="px-2 py-1 text-xs text-gray-500">{formatDuration(item.duration)}</div>
	<div class="px-2 py-1">
		<div class="space-y-1">
			{#each mediaVersions as mediaItem, i}
				{@const size = mediaItem?.Part?.[0]?.size || 0}
				{@const overallBitrate = getBitrate(mediaItem, 0)}
				{@const videoBitrate = getBitrate(mediaItem, 1)}
				{@const sizePercentile = calculatePercentileFn(size, allSizes)}
				{@const overallBitratePercentile = calculatePercentileFn(
					overallBitrate,
					allOverallBitrates
				)}
				<div
					class="flex items-center space-x-2 {i > 0 ? 'mt-1 pt-1 border-t border-gray-100' : ''}"
				>
					<div class="text-xs w-14 {getPercentileColor(sizePercentile)}">
						{formatFileSize(size)}
						<span class="opacity-75">({sizePercentile}p)</span>
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
					<div class="text-xs w-14 {getPercentileColor(overallBitratePercentile)}">
						{overallBitrate}k
						<span class="opacity-75">({overallBitratePercentile}p)</span>
					</div>
					<div class="text-xs text-gray-500 w-14">
						{videoBitrate}k
					</div>
					<div class="text-xs text-gray-500 w-14">{getBitrate(mediaItem, 2)}k</div>
				</div>
			{/each}
		</div>
	</div>
</div>
