<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Header from '../../../../components/Header.svelte';

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
		if (allValues.length === 0) return 0;
		const sorted = [...allValues].sort((a, b) => a - b);
		const index = sorted.indexOf(value);
		return Math.round((index / (sorted.length - 1)) * 100);
	}

	function getPercentileBucket(percentile: number): QualityBucket {
		if (percentile >= 90) return '90p+';
		if (percentile >= 75) return '75-89p';
		if (percentile >= 50) return '50-74p';
		if (percentile >= 25) return '25-49p';
		return '<25p';
	}

	function formatFileSize(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let size = bytes;
		let unitIndex = 0;
		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}
		return `${size.toFixed(2)} ${units[unitIndex]}`;
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

		// Get all bitrates and sizes
		const allBitrates = media
			.flatMap((item) => item.Media?.map((m) => m.bitrate || 0) || [])
			.filter((br) => br > 0);

		const allSizes = media
			.flatMap((item) => item.Media?.map((m) => m.Part?.[0]?.size || 0) || [])
			.filter((size) => size > 0);

		// Calculate quality buckets
		media.forEach((item) => {
			const bitrate = item.Media?.[0]?.bitrate || 0;
			if (bitrate > 0) {
				const percentile = calculatePercentile(bitrate, allBitrates);
				const bucket = getPercentileBucket(percentile);
				qualityBuckets[bucket]++;
			}

			// Calculate codec stats
			const videoStream = item.Media?.[0]?.Part?.[0]?.Stream?.find((s) => s.streamType === 1);
			if (videoStream?.codec) {
				if (videoStream.codec.includes('hevc')) codecStats.hevc++;
				else if (videoStream.codec.includes('h264')) codecStats.h264++;
				else codecStats.other++;
			}
		});

		// Calculate file size stats
		if (allSizes.length > 0) {
			const sorted = [...allSizes].sort((a, b) => a - b);
			fileSizeStats.min = sorted[0];
			fileSizeStats.max = sorted[sorted.length - 1];
			fileSizeStats.avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
			fileSizeStats.median = sorted[Math.floor(sorted.length / 2)];
			fileSizeStats.p90 = sorted[Math.floor(sorted.length * 0.9)];
			fileSizeStats.p95 = sorted[Math.floor(sorted.length * 0.95)];

			// Create size histogram buckets
			const bucketCount = 10;
			const bucketSize = (fileSizeStats.max - fileSizeStats.min) / bucketCount;
			fileSizeStats.histogram = Array.from({ length: bucketCount }, (_, i) => {
				const start = fileSizeStats.min + i * bucketSize;
				const end = start + bucketSize;
				const count = sorted.filter((size) => size >= start && size < end).length;
				return {
					bucket: `${formatFileSize(start)} - ${formatFileSize(end)}`,
					count
				};
			});
		}
	}

	async function fetchMedia() {
		const token = localStorage.getItem('plexToken');
		const clientId = localStorage.getItem('plexClientId');
		const serverUrl = localStorage.getItem('plexServerUrl');

		if (!token || !clientId || !serverUrl) {
			goto('/login');
			return;
		}

		const headers = {
			Accept: 'application/json',
			'X-Plex-Token': token,
			'X-Plex-Client-Identifier': clientId,
			'X-Plex-Product': 'Plexman',
			'X-Plex-Version': '1.0.0',
			'X-Plex-Platform': 'Web',
			'X-Plex-Platform-Version': '1.0.0',
			'X-Plex-Device': 'Browser',
			'X-Plex-Device-Name': 'Plexman Web'
		};

		try {
			const response = await fetch(
				`${serverUrl}/library/sections/${libraryId}/all?` +
					new URLSearchParams({
						includeExternalMedia: '1',
						includePreferences: '1',
						checkFiles: '1',
						asyncCheckFiles: '0'
					}),
				{ headers }
			);

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData?.errors?.[0]?.message || 'Failed to fetch media');
			}

			const data = await response.json();
			media = data.MediaContainer.Metadata || [];
			calculateStats();
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
			if (error.includes('X-Plex-Token is missing') || error.includes('invalid')) {
				localStorage.removeItem('plexToken');
				goto('/login');
			}
		} finally {
			loading = false;
		}
	}

	async function fetchLibraries() {
		const token = localStorage.getItem('plexToken');
		const clientId = localStorage.getItem('plexClientId');
		const serverUrl = localStorage.getItem('plexServerUrl');

		if (!token || !clientId || !serverUrl) {
			goto('/login');
			return;
		}

		const headers = {
			Accept: 'application/json',
			'X-Plex-Token': token,
			'X-Plex-Client-Identifier': clientId,
			'X-Plex-Product': 'Plexman',
			'X-Plex-Version': '1.0.0',
			'X-Plex-Platform': 'Web',
			'X-Plex-Platform-Version': '1.0.0',
			'X-Plex-Device': 'Browser',
			'X-Plex-Device-Name': 'Plexman Web'
		};

		try {
			const response = await fetch(`${serverUrl}/library/sections`, { headers });
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData?.errors?.[0]?.message || 'Failed to fetch libraries');
			}
			const data = await response.json();
			libraries = data.MediaContainer.Directory;
		} catch (e) {
			console.error('Failed to fetch libraries:', e);
		}
	}

	onMount(() => {
		fetchMedia();
		fetchLibraries();
	});
</script>

<div class="min-h-screen bg-gray-100">
	<Header {libraries} />

	<main class="max-w-7xl mx-auto py-4 sm:px-4 lg:px-6">
		{#if loading}
			<div class="flex justify-center items-center h-32">
				<div class="w-8 h-8 border-t-2 border-orange-500 border-solid rounded-full animate-spin" />
			</div>
		{:else if error}
			<div class="bg-red-50 p-3 rounded-md">
				<div class="flex">
					<div class="flex-shrink-0">
						<svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
							<path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
								clip-rule="evenodd"
							/>
						</svg>
					</div>
					<div class="ml-3">
						<h3 class="text-sm font-medium text-red-800">Error loading media</h3>
						<div class="mt-1 text-sm text-red-700">{error}</div>
					</div>
				</div>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<!-- Quality Distribution -->
				<div class="bg-white shadow rounded-lg p-4">
					<h2 class="text-sm font-medium text-gray-900 mb-3">Quality Distribution</h2>
					<div class="grid grid-cols-5 gap-2">
						{#each Object.entries(qualityBuckets) as [bucket, count]}
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
							<div class="text-xs text-gray-500">HEVC</div>
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
					<div class="flex items-center justify-between mb-3">
						<h2 class="text-sm font-medium text-gray-900">File Size Statistics</h2>
						<div class="flex space-x-4 text-sm">
							<div>
								<span class="text-gray-500">Avg:</span>
								<span class="font-medium ml-1">{formatFileSize(fileSizeStats.avg)}</span>
							</div>
							<div>
								<span class="text-gray-500">Median:</span>
								<span class="font-medium ml-1">{formatFileSize(fileSizeStats.median)}</span>
							</div>
							<div>
								<span class="text-gray-500">90th:</span>
								<span class="font-medium ml-1">{formatFileSize(fileSizeStats.p90)}</span>
							</div>
						</div>
					</div>

					<!-- File Size Histogram -->
					<div class="space-y-1">
						{#each fileSizeStats.histogram as { bucket, count }}
							<div class="flex items-center text-sm">
								<div class="w-24 text-xs text-gray-500 truncate" title={bucket}>{bucket}</div>
								<div class="flex-1 mx-2">
									<div
										class="bg-orange-200 rounded-sm"
										style="width: {(count / media.length) * 100}%; height: 16px;"
									/>
								</div>
								<div class="w-10 text-xs text-gray-500 text-right">{count}</div>
							</div>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	</main>
</div>
