<script lang="ts">
	import { onMount, afterUpdate } from 'svelte';

	export let item: any;
	export let detailedMedia: Map<string, any>;
	export let onDebug: (movie: any) => Promise<void>;
	export let formatDuration: (ms: number) => string;
	export let formatFileSize: (bytes: number) => string;

	let rowElement: HTMLElement;
	let observer: IntersectionObserver;

	function setupObserver() {
		if (observer) {
			observer.disconnect();
		}

		observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting && !detailedMedia.has(item.ratingKey)) {
						onDebug(item);
						observer.unobserve(entry.target);
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
</script>

<tr class="hover:bg-gray-50" bind:this={rowElement}>
	<td class="px-1 py-2">
		<button
			on:click={() => onDebug(item)}
			class="text-gray-400 hover:text-gray-600 transition-colors"
			title="Debug movie data"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4"
				viewBox="0 0 20 20"
				fill="currentColor"
			>
				<path
					fill-rule="evenodd"
					d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>
	</td>
	<td class="px-3 py-2">
		{#if item.thumb}
			<img
				src={`${localStorage.getItem('plexServerUrl')}${item.thumb}?X-Plex-Token=${localStorage.getItem('plexToken')}`}
				alt={item.title}
				class="h-16 w-auto rounded shadow-sm"
				loading="lazy"
				decoding="async"
			/>
		{/if}
	</td>
	<td class="px-3 py-2">
		<div>
			<div class="text-sm font-medium text-gray-900 leading-tight">
				{item.title}
			</div>
			{#if item.originalTitle && item.originalTitle !== item.title}
				<div class="text-xs text-gray-500 leading-tight">{item.originalTitle}</div>
			{/if}
		</div>
	</td>
	<td class="px-3 py-2 text-xs text-gray-500">
		{item.year || '-'}
	</td>
	<td class="px-3 py-2 text-xs text-gray-500">
		{formatDuration(item.duration)}
	</td>
	<td class="px-3 py-2 text-xs text-gray-500">
		{#if item.Media?.[0]?.Part?.[0]?.size}
			{formatFileSize(item.Media[0].Part[0].size)}
		{:else}
			-
		{/if}
	</td>
	<td class="px-3 py-2">
		{#if item.Media?.[0]?.videoCodec}
			{@const codec = item.Media[0].videoCodec.toLowerCase()}
			<span
				class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium {codec === 'hevc'
					? 'bg-green-100 text-green-800'
					: codec === 'h264'
						? 'bg-blue-100 text-blue-800'
						: codec === 'mpeg4'
							? 'bg-yellow-100 text-yellow-800'
							: codec === 'mpeg2video'
								? 'bg-red-100 text-red-800'
								: 'bg-gray-100 text-gray-800'}"
			>
				{item.Media[0].videoCodec.toUpperCase()}
			</span>
		{:else}
			-
		{/if}
	</td>
	<td class="px-3 py-2 text-xs text-gray-500">
		{#if item.Media?.[0]?.bitrate}
			{item.Media[0].bitrate} Kbps
		{:else}
			-
		{/if}
	</td>
	<td class="px-3 py-2 text-xs text-gray-500">
		{#if detailedMedia.get(item.ratingKey)?.Media?.[0]?.Part?.[0]?.Stream}
			{@const videoStream = detailedMedia
				.get(item.ratingKey)
				.Media[0].Part[0].Stream.find((s: any) => s.streamType === 1)}
			{#if videoStream?.bitrate}
				{videoStream.bitrate} Kbps
			{:else}
				-
			{/if}
		{:else if item.Media?.[0]?.Part?.[0]?.Stream}
			{@const videoStream = item.Media[0].Part[0].Stream.find((s: any) => s.streamType === 1)}
			{#if videoStream?.bitrate}
				{videoStream.bitrate} Kbps
			{:else}
				-
			{/if}
		{:else}
			-
		{/if}
	</td>
	<td class="px-3 py-2 text-xs text-gray-500">
		{#if detailedMedia.get(item.ratingKey)?.Media?.[0]?.Part?.[0]?.Stream}
			{@const audioStream = detailedMedia
				.get(item.ratingKey)
				.Media[0].Part[0].Stream.find((s: any) => s.streamType === 2)}
			{#if audioStream?.bitrate}
				{audioStream.bitrate} Kbps
			{:else}
				-
			{/if}
		{:else if item.Media?.[0]?.Part?.[0]?.Stream}
			{@const audioStream = item.Media[0].Part[0].Stream.find((s: any) => s.streamType === 2)}
			{#if audioStream?.bitrate}
				{audioStream.bitrate} Kbps
			{:else}
				-
			{/if}
		{:else}
			-
		{/if}
	</td>
</tr>
