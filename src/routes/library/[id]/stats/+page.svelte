<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Header from '../../../../components/Header.svelte';

	// Access server data
	$: ({ plexToken, plexServerUrl } = $page.data);

	interface Stream {
		streamType: number;
		codec?: string;
		bitrate?: number;
	}

	type QualityBucket = '90p+' | '75-89p' | '50-74p' | '25-49p' | '<25p';

	interface MediaPart {
		size: number;
		Stream?: Stream[];
	}

	interface MediaItem {
		bitrate?: number;
		Part?: MediaPart[];
	}

	interface PlexItem {
		ratingKey: string;
		title: string;
		Media?: MediaItem[];
	}

	let media: PlexItem[] = [];
	let loading = true;
	let error: string | null = null;
	let libraries: any[] = [];

	// Stats data
	let qualityBuckets: Record<QualityBucket, number> = {
		'90p+': 0,
		'75-89p': 0,
		'50-74p': 0,
		'25-49p': 0,
		'<25p': 0
	};

	let codecStats = {
		hevc: 0,
		h264: 0,
		other: 0
	};

	let fileSizeStats = {
		min: 0,
		max: 0,
		avg: 0,
		median: 0,
		p90: 0,
		p95: 0,
		histogram: [] as { bucket: string; count: number }[]
	};

	$: libraryId = $page.params.id;

	function calculatePercentile(value: number, allValues: number[]): number {
		if (allValues.length === 0 || value <= 0) return 0;
		const sorted = [...allValues].sort((a, b) => a - b);
		let count = 0;
		for (const v of sorted) {
			if (v <= value) {
				count++;
			} else {
				break;
			}
		}
		return Math.round((count / sorted.length) * 100);
	}

	function getPercentileBucket(percentile: number): QualityBucket {
		if (percentile >= 90) return '90p+';
		if (percentile >= 75) return '75-89p';
		if (percentile >= 50) return '50-74p';
		if (percentile >= 25) return '25-49p';
		return '<25p';
	}

	function formatFileSize(bytes: number): string {
		if (!bytes || bytes <= 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let size = bytes;
		let unitIndex = 0;
		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}
		return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
	}

	function calculateStats() {
		// Reset stats
		qualityBuckets = {
			'90p+': 0,
			'75-89p': 0,
			'50-74p': 0,
			'25-49p': 0,
			'<25p': 0
		};
		codecStats = { hevc: 0, h264: 0, other: 0 };
		fileSizeStats = { min: 0, max: 0, avg: 0, median: 0, p90: 0, p95: 0, histogram: [] };

		// Get all bitrates and sizes
		const allBitrates = media
			.flatMap((item) => item.Media?.map((m) => m.bitrate || 0) || [])
			.filter((br) => br > 0);

		const allSizes = media
			.flatMap((item) => item.Media?.map((m) => m.Part?.[0]?.size || 0) || [])
			.filter((size) => size > 0);

		if (media.length === 0) return; // No data to process

		// Calculate quality buckets and codec stats
		media.forEach((item) => {
			const bitrate = item.Media?.[0]?.bitrate || 0;
			if (bitrate > 0 && allBitrates.length > 0) {
				const percentile = calculatePercentile(bitrate, allBitrates);
				const bucket = getPercentileBucket(percentile);
				qualityBuckets[bucket]++;
			}

			const videoStream = item.Media?.[0]?.Part?.[0]?.Stream?.find((s) => s.streamType === 1);
			if (videoStream?.codec) {
				if (videoStream.codec.includes('hevc') || videoStream.codec.includes('h265'))
					codecStats.hevc++;
				else if (videoStream.codec.includes('h264')) codecStats.h264++;
				else codecStats.other++;
			}
		});

		// Calculate file size stats
		if (allSizes.length > 0) {
			const sortedSizes = [...allSizes].sort((a, b) => a - b);
			fileSizeStats.min = sortedSizes[0];
			fileSizeStats.max = sortedSizes[sortedSizes.length - 1];
			fileSizeStats.avg = sortedSizes.reduce((a, b) => a + b, 0) / sortedSizes.length;
			fileSizeStats.median = sortedSizes[Math.floor(sortedSizes.length / 2)];
			fileSizeStats.p90 = sortedSizes[Math.floor(sortedSizes.length * 0.9)];
			fileSizeStats.p95 = sortedSizes[Math.floor(sortedSizes.length * 0.95)];

			// Create size histogram buckets
			const bucketCount = 10;
			const minLog = fileSizeStats.min > 0 ? Math.log10(fileSizeStats.min) : 0;
			const maxLog = fileSizeStats.max > 0 ? Math.log10(fileSizeStats.max) : 0;
			const bucketSizeLog = (maxLog - minLog) / bucketCount;

			fileSizeStats.histogram = Array.from({ length: bucketCount }, (_, i) => {
				const startLog = minLog + i * bucketSizeLog;
				const endLog = startLog + bucketSizeLog;
				const start = Math.pow(10, startLog);
				const end = Math.pow(10, endLog);

				// Count items within the bucket range
				const count = sortedSizes.filter(
					(size) => size >= start && (i === bucketCount - 1 ? size <= end : size < end)
				).length;

				return {
					bucket: `${formatFileSize(start)} - ${formatFileSize(end)}`,
					count
				};
			});
		} else {
			fileSizeStats.histogram = []; // Ensure histogram is empty if no sizes
		}
	}

	async function fetchMedia() {
		if (!libraryId) return; // Wait for libraryId
		loading = true;
		error = null;
		try {
			if (!plexServerUrl || !plexToken) {
				throw new Error('Not authenticated');
			}
			const params = new URLSearchParams({
				includeExternalMedia: '1',
				includePreferences: '1',
				'X-Plex-Token': plexToken
			});
			const response = await fetch(
				`${plexServerUrl}/library/sections/${libraryId}/all?${params.toString()}`,
				{ headers: { Accept: 'application/json' } }
			);

			if (!response.ok) {
				let errorMsg = 'Failed to fetch media';
				try {
					const errorData = await response.json();
					errorMsg = errorData?.message || errorData?.error || errorMsg;
				} catch (_) {}
				if (response.status === 401) goto('/login');
				throw new Error(`${errorMsg} (Status: ${response.status})`);
			}

			const data = await response.json();
			media = data.MediaContainer.Metadata || [];
			calculateStats(); // Calculate stats after fetching data
		} catch (e: any) {
			console.error('Failed to fetch media:', e);
			media = []; // Clear media on error
			error = e.message || 'An error occurred fetching media.';
			// Reset stats on error
			calculateStats();
		} finally {
			loading = false;
		}
	}

	async function fetchLibraries() {
		try {
			if (!plexServerUrl || !plexToken) {
				throw new Error('Not authenticated');
			}
			const response = await fetch(
				`${plexServerUrl}/library/sections?X-Plex-Token=${plexToken}`,
				{ headers: { Accept: 'application/json' } }
			);
			if (!response.ok) {
				let errorMsg = 'Failed to fetch libraries';
				try {
					const errorData = await response.json();
					errorMsg = errorData?.message || errorData?.error || errorMsg;
				} catch (_) {}
				if (response.status === 401) {
					// Don't goto login here, might be loading stats page directly
					error = 'Authentication error loading libraries.';
				} else {
					error = `${errorMsg} (Status: ${response.status})`;
				}
				throw new Error(error || 'Failed to fetch libraries');
			}
			const data = await response.json();
			libraries = data.MediaContainer.Directory || [];
		} catch (e: any) {
			console.error('Failed to fetch libraries for header:', e);
			libraries = []; // Ensure libraries is empty on error
			// Don't necessarily set global error here, header might just be incomplete
		}
	}

	onMount(() => {
		fetchLibraries(); // Fetch libraries for header
		fetchMedia(); // Fetch media for stats
	});
</script>

<svelte:head>
	<title>Stats for {libraries.find((l) => l.key === libraryId)?.title || 'Library'} - Plexman</title
	>
</svelte:head>

<div class="min-h-screen bg-gray-100">
	<Header {libraries} {plexToken} {plexServerUrl} hideSearch={true} />

	<main class="max-w-7xl mx-auto py-4 sm:px-4 lg:px-6">
		{#if loading}
			<div class="flex justify-center items-center h-32">
				<div class="w-8 h-8 border-t-2 border-orange-500 border-solid rounded-full animate-spin" />
			</div>
		{:else if error}
			<div
				class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative"
				role="alert"
			>
				<strong class="font-bold">Error!</strong>
				<span class="block sm:inline">{error}</span>
			</div>
		{:else if media.length === 0}
			<div class="text-center py-12">
				<p class="text-sm text-gray-500">No media found in this library to calculate statistics.</p>
			</div>
		{:else}
			<!-- Stats Display Grid -->
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<!-- Quality Distribution -->
				<div class="bg-white shadow rounded-lg p-4">
					<h2 class="text-sm font-medium text-gray-900 mb-3">
						Bitrate Quality Distribution (Percentile)
					</h2>
					<div class="grid grid-cols-5 gap-2">
						{#each Object.entries(qualityBuckets) as [bucket, count] (bucket)}
							<div class="text-center">
								<div class="text-xl font-bold">{count}</div>
								<div class="text-xs text-gray-500">{bucket}</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Codec Distribution -->
				<div class="bg-white shadow rounded-lg p-4">
					<h2 class="text-sm font-medium text-gray-900 mb-3">Codec Distribution</h2>
					<div class="grid grid-cols-3 gap-2">
						<div class="text-center">
							<div class="text-xl font-bold">{codecStats.hevc}</div>
							<div class="text-xs text-gray-500">HEVC/H.265</div>
						</div>
						<div class="text-center">
							<div class="text-xl font-bold">{codecStats.h264}</div>
							<div class="text-xs text-gray-500">H.264</div>
						</div>
						<div class="text-center">
							<div class="text-xl font-bold">{codecStats.other}</div>
							<div class="text-xs text-gray-500">Other</div>
						</div>
					</div>
				</div>

				<!-- File Size Stats -->
				<div class="bg-white shadow rounded-lg p-4 md:col-span-2">
					<div class="flex flex-wrap items-center justify-between mb-3 gap-y-2">
						<h2 class="text-sm font-medium text-gray-900">File Size Statistics</h2>
						<div class="flex flex-wrap space-x-3 text-xs sm:text-sm">
							<div>
								<span class="text-gray-500">Min:</span><span class="font-medium ml-1"
									>{formatFileSize(fileSizeStats.min)}</span
								>
							</div>
							<div>
								<span class="text-gray-500">Max:</span><span class="font-medium ml-1"
									>{formatFileSize(fileSizeStats.max)}</span
								>
							</div>
							<div>
								<span class="text-gray-500">Avg:</span><span class="font-medium ml-1"
									>{formatFileSize(fileSizeStats.avg)}</span
								>
							</div>
							<div>
								<span class="text-gray-500">Median:</span><span class="font-medium ml-1"
									>{formatFileSize(fileSizeStats.median)}</span
								>
							</div>
							<div>
								<span class="text-gray-500">P90:</span><span class="font-medium ml-1"
									>{formatFileSize(fileSizeStats.p90)}</span
								>
							</div>
							<div>
								<span class="text-gray-500">P95:</span><span class="font-medium ml-1"
									>{formatFileSize(fileSizeStats.p95)}</span
								>
							</div>
						</div>
					</div>

					<!-- File Size Histogram -->
					<div class="space-y-1 mt-4">
						{#if fileSizeStats.histogram.length > 0}
							{@const maxCount = Math.max(...fileSizeStats.histogram.map((b) => b.count))}
							{#each fileSizeStats.histogram as { bucket, count } (bucket)}
								<div class="flex items-center text-sm">
									<div class="w-28 sm:w-32 text-xs text-gray-500 truncate" title={bucket}>
										{bucket}
									</div>
									<div class="flex-1 mx-2 bg-gray-100 rounded-sm h-4 overflow-hidden">
										{#if maxCount > 0}
											<div
												class="bg-orange-400 h-full"
												style="width: {(count / maxCount) * 100}%;"
											></div>
										{/if}
									</div>
									<div class="w-10 text-xs text-gray-500 text-right">{count}</div>
								</div>
							{/each}
						{:else}
							<p class="text-xs text-gray-400 text-center">No file size data available.</p>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</main>
</div>
