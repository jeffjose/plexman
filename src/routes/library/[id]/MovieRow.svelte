<script lang="ts">
	import { onMount, afterUpdate } from 'svelte';

	export let item: any;
	export let detailedMedia: Map<string, any>;
	export let onDebug: (movie: any) => Promise<void>;
	export let formatDuration: (ms: number) => string;
	export let formatFileSize: (bytes: number) => string;

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
		<div class="font-medium text-sm text-gray-900">{item.title}</div>
		{#if item.originalTitle && item.originalTitle !== item.title}
			<div class="text-xs text-gray-500">{item.originalTitle}</div>
		{/if}
	</td>
	<td class="px-2 py-1 text-xs text-gray-500">{item.year}</td>
	<td class="px-2 py-1 text-xs text-gray-500">{formatDuration(item.duration)}</td>
	<td class="px-2 py-1">
		<div class="space-y-1">
			{#each mediaVersions as mediaItem, i}
				<div
					class="flex items-center space-x-2 {i > 0 ? 'mt-1 pt-1 border-t border-gray-100' : ''}"
				>
					<div class="text-xs text-gray-500 w-14">
						{formatFileSize(mediaItem?.Part?.[0]?.size || 0)}
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
					<div class="text-xs text-gray-500 w-14">{getBitrate(mediaItem, 0)}k</div>
					<div class="text-xs text-gray-500 w-14">{getBitrate(mediaItem, 1)}k</div>
					<div class="text-xs text-gray-500 w-14">{getBitrate(mediaItem, 2)}k</div>
				</div>
			{/each}
		</div>
	</td>
</tr>
