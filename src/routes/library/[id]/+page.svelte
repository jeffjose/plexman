<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import MovieRow from './MovieRow.svelte';
	import { writable, derived } from 'svelte/store';

	let media: any[] = [];
	let loading = true;
	let error: string | null = null;
	let sortField = 'title';
	let sortDirection = 'asc';

	const searchQuery = writable('');
	const sortFieldStore = writable(sortField);
	const sortDirectionStore = writable(sortDirection);
	let searchInput = '';
	let searchTimeout: ReturnType<typeof setTimeout>;

	function debounceSearch(value: string) {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchQuery.set(value);
		}, 250);
	}

	$: libraryId = $page.params.id;
	$: type = $page.url.searchParams.get('type');

	const filteredMedia = derived(
		[searchQuery, sortFieldStore, sortDirectionStore],
		([$searchQuery, $sortField, $sortDirection]) => {
			// First filter the media
			let result = !$searchQuery
				? media
				: media.filter(
						(item) =>
							item.title.toLowerCase().includes($searchQuery.toLowerCase()) ||
							(item.originalTitle &&
								item.originalTitle.toLowerCase().includes($searchQuery.toLowerCase()))
					);

			// Then sort the filtered results
			return [...result].sort((a, b) => {
				let aVal: any;
				let bVal: any;

				switch ($sortField) {
					case 'overallBitrate':
						aVal = a.Media?.[0]?.bitrate || 0;
						bVal = b.Media?.[0]?.bitrate || 0;
						break;
					case 'videoBitrate': {
						const aDetailed = detailedMedia.get(a.ratingKey);
						const bDetailed = detailedMedia.get(b.ratingKey);
						aVal =
							aDetailed?.Media?.[0]?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 1)
								?.bitrate ||
							a.Media?.[0]?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 1)?.bitrate ||
							0;
						bVal =
							bDetailed?.Media?.[0]?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 1)
								?.bitrate ||
							b.Media?.[0]?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 1)?.bitrate ||
							0;
						break;
					}
					case 'audioBitrate': {
						const aDetailed = detailedMedia.get(a.ratingKey);
						const bDetailed = detailedMedia.get(b.ratingKey);
						aVal =
							aDetailed?.Media?.[0]?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 2)
								?.bitrate ||
							a.Media?.[0]?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 2)?.bitrate ||
							0;
						bVal =
							bDetailed?.Media?.[0]?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 2)
								?.bitrate ||
							b.Media?.[0]?.Part?.[0]?.Stream?.find((s: any) => s.streamType === 2)?.bitrate ||
							0;
						break;
					}
					default:
						aVal = a[$sortField] || '';
						bVal = b[$sortField] || '';
				}

				if (typeof aVal === 'number' && typeof bVal === 'number') {
					return $sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
				}
				return $sortDirection === 'asc'
					? aVal.toString().localeCompare(bVal.toString())
					: bVal.toString().localeCompare(aVal.toString());
			});
		}
	);

	let detailedMedia = new Map<string, any>(); // Store detailed info by ratingKey

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
			'X-Plex-Device-Name': 'Plexman Web',
			'X-Plex-Features': 'external-media,indirect-media,hub-style-list',
			'X-Plex-Language': 'en',
			'X-Plex-Provider-Version': '7.2'
		};

		try {
			// First get the list of movies
			const response = await fetch(
				`${serverUrl}/library/sections/${libraryId}/all?` +
					new URLSearchParams({
						type: type === 'movie' ? '1' : '2',
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

	function handleSort(field: string) {
		if (sortField === field) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
			sortDirectionStore.set(sortDirection);
		} else {
			sortField = field;
			sortFieldStore.set(field);
			sortDirection = 'asc';
			sortDirectionStore.set('asc');
		}
	}

	function formatDuration(ms: number): string {
		const hours = Math.floor(ms / 3600000);
		const minutes = Math.floor((ms % 3600000) / 60000);
		const seconds = Math.floor((ms % 60000) / 1000);
		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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

	function formatBitrate(bitrate: number): string {
		const item = media.find((m) => m.Media?.[0]?.bitrate === bitrate);
		if (!item) return `${bitrate} Kbps`;

		const mediaInfo = item.Media?.[0];
		if (!mediaInfo) return `${bitrate} Kbps`;

		const streams = mediaInfo.Part?.[0]?.Stream;
		if (!streams) return `${bitrate} Kbps`;

		// Get video stream bitrate directly from API
		const videoStream = streams.find((s: any) => s.streamType === 1);
		if (videoStream?.bitrate) {
			return `${videoStream.bitrate} Kbps`;
		}

		// If no video stream bitrate, return total
		return `${bitrate} Kbps`;
	}

	async function debugMovie(movie: any) {
		const token = localStorage.getItem('plexToken');
		const clientId = localStorage.getItem('plexClientId');
		const serverUrl = localStorage.getItem('plexServerUrl');

		if (!token || !clientId || !serverUrl) return;

		const headers = {
			Accept: 'application/json',
			'X-Plex-Token': token,
			'X-Plex-Client-Identifier': clientId,
			'X-Plex-Product': 'Plexman',
			'X-Plex-Version': '1.0.0',
			'X-Plex-Platform': 'Web',
			'X-Plex-Platform-Version': '1.0.0',
			'X-Plex-Device': 'Browser',
			'X-Plex-Device-Name': 'Plexman Web',
			'X-Plex-Features': 'external-media,indirect-media,hub-style-list',
			'X-Plex-Language': 'en',
			'X-Plex-Provider-Version': '7.2'
		};

		try {
			const response = await fetch(
				`${serverUrl}/library/metadata/${movie.ratingKey}?` +
					new URLSearchParams({
						includeExternalMedia: '1',
						includePreferences: '1',
						checkFiles: '1',
						asyncCheckFiles: '0'
					}),
				{ headers }
			);

			if (!response.ok) return;

			const data = await response.json();
			const item = data.MediaContainer.Metadata[0];
			detailedMedia.set(movie.ratingKey, item);
			detailedMedia = detailedMedia; // Trigger reactivity
		} catch (e) {
			console.error('Failed to fetch detailed metadata:', e);
		}
	}

	onMount(() => {
		if (type !== 'movie') {
			error = 'Only movie libraries are supported at the moment';
			loading = false;
			return;
		}
		fetchMedia();
	});
</script>

<div class="min-h-screen bg-gray-100">
	<nav class="bg-white shadow-sm">
		<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
			<div class="flex justify-between h-16">
				<div class="flex items-center">
					<a href="/" class="text-2xl font-bold text-gray-900">Plexman</a>
				</div>
			</div>
		</div>
	</nav>

	<main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
		{#if loading}
			<div class="flex justify-center items-center h-64">
				<div
					class="w-16 h-16 border-t-4 border-orange-500 border-solid rounded-full animate-spin"
				></div>
			</div>
		{:else if error}
			<div class="bg-red-50 p-4 rounded-md">
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
						<div class="mt-2 text-sm text-red-700">{error}</div>
					</div>
				</div>
			</div>
		{:else}
			<div class="mb-4">
				<div class="relative">
					<input
						type="text"
						bind:value={searchInput}
						on:input={() => debounceSearch(searchInput)}
						placeholder="Search movies..."
						class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
					/>
					{#if searchInput}
						<button
							on:click={() => {
								searchInput = '';
								searchQuery.set('');
							}}
							class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-5 w-5"
								viewBox="0 0 20 20"
								fill="currentColor"
							>
								<path
									fill-rule="evenodd"
									d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
									clip-rule="evenodd"
								/>
							</svg>
						</button>
					{/if}
				</div>
			</div>
			<div class="bg-white shadow-sm rounded-lg overflow-hidden">
				<div class="overflow-x-auto">
					<table class="min-w-full divide-y divide-gray-200">
						<thead class="bg-gray-50">
							<tr>
								<th class="px-1 py-1 w-12"></th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
								>
									Title
								</th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-14"
								>
									Year
								</th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20"
								>
									Duration
								</th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
								>
									<div class="flex items-center space-x-2">
										<div class="w-14">Size</div>
										<div class="w-24">Format</div>
										<div
											class="w-14 cursor-pointer hover:bg-gray-100"
											on:click={() => handleSort('overallBitrate')}
										>
											Overall
											{#if sortField === 'overallBitrate'}
												<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
											{/if}
										</div>
										<div
											class="w-14 cursor-pointer hover:bg-gray-100"
											on:click={() => handleSort('videoBitrate')}
										>
											Video
											{#if sortField === 'videoBitrate'}
												<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
											{/if}
										</div>
										<div
											class="w-14 cursor-pointer hover:bg-gray-100"
											on:click={() => handleSort('audioBitrate')}
										>
											Audio
											{#if sortField === 'audioBitrate'}
												<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
											{/if}
										</div>
									</div>
								</th>
							</tr>
						</thead>
						<tbody class="bg-white divide-y divide-gray-200">
							{#each $filteredMedia as item (item.ratingKey)}
								<MovieRow
									{item}
									{detailedMedia}
									onDebug={debugMovie}
									{formatDuration}
									{formatFileSize}
								/>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</main>
</div>
