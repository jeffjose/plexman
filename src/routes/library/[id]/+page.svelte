<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { writable, derived } from 'svelte/store';
	import Header from '../../../components/Header.svelte';
	import MovieRow from './MovieRow.svelte';
	import ShowRow from './ShowRow.svelte';

	interface Stream {
		streamType: number;
		bitrate?: number;
	}

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
		originalTitle?: string;
		year?: number;
		originallyAvailableAt?: string;
		Media?: MediaItem[];
		[key: string]: any; // Allow any string key for dynamic access
	}

	let media: PlexItem[] = [];
	let loading = true;
	let error: string | null = null;
	let sortField = 'addedAt';
	let sortDirection = 'desc';
	let libraries: any[] = [];
	let allSizes: number[] = [];
	let allOverallBitrates: number[] = [];
	let allVideoBitrates: number[] = [];
	const qualityFilter = writable<string | null>(null);
	const showMultiFileOnly = writable(false);

	const SORT_OPTIONS = [
		{ label: 'Recently Added ↓', field: 'addedAt', direction: 'desc' },
		{ label: 'Recently Added ↑', field: 'addedAt', direction: 'asc' },
		{ label: 'Release Date ↓', field: 'originallyAvailableAt', direction: 'desc' },
		{ label: 'Release Date ↑', field: 'originallyAvailableAt', direction: 'asc' },
		{ label: 'Title A-Z', field: 'title', direction: 'asc' },
		{ label: 'Title Z-A', field: 'title', direction: 'desc' }
	];

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
	$: type = $page.url.searchParams.get('type') || 'movie';

	const filteredMedia = derived(
		[searchQuery, sortFieldStore, sortDirectionStore, qualityFilter, showMultiFileOnly],
		([$searchQuery, $sortField, $sortDirection, $qualityFilter, $showMultiFileOnly]) => {
			// Start with the original media list
			let result = media;

			// Apply search filter if there's a query
			if ($searchQuery) {
				result = result.filter((item) => {
					const searchLower = $searchQuery.toLowerCase();
					return (
						item.title.toLowerCase().includes(searchLower) ||
						(item.originalTitle || '').toLowerCase().includes(searchLower) ||
						(type === 'show' && item.year?.toString().includes(searchLower))
					);
				});
			}

			// Apply quality filter if selected
			if ($qualityFilter && type === 'movie') {
				result = media.filter((item) => {
					const mediaInfo = item.Media?.[0];
					if (!mediaInfo) return false;

					const size = mediaInfo.Part?.[0]?.size || 0;
					const bitrate = mediaInfo.bitrate || 0;
					const { sizePercentile, overallBitratePercentile } = getPercentiles(size, bitrate);
					const avgPercentile = (sizePercentile + overallBitratePercentile) / 2;

					switch ($qualityFilter) {
						case '90p+':
							return avgPercentile >= 90;
						case '75-89p':
							return avgPercentile >= 75 && avgPercentile < 90;
						case '50-74p':
							return avgPercentile >= 50 && avgPercentile < 75;
						case '25-49p':
							return avgPercentile >= 25 && avgPercentile < 50;
						case '<25p':
							return avgPercentile < 25;
						default:
							return true;
					}
				});
			}

			// Apply multi-file filter if selected
			if ($showMultiFileOnly && type === 'movie') {
				result = media.filter((item) => {
					return item.Media && item.Media.length > 1;
				});
			}

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
							aDetailed?.Media?.[0]?.Part?.[0]?.Stream?.find((s: Stream) => s.streamType === 1)
								?.bitrate ||
							a.Media?.[0]?.Part?.[0]?.Stream?.find((s: Stream) => s.streamType === 1)?.bitrate ||
							0;
						bVal =
							bDetailed?.Media?.[0]?.Part?.[0]?.Stream?.find((s: Stream) => s.streamType === 1)
								?.bitrate ||
							b.Media?.[0]?.Part?.[0]?.Stream?.find((s: Stream) => s.streamType === 1)?.bitrate ||
							0;
						break;
					}
					case 'originallyAvailableAt':
						aVal = a.originallyAvailableAt || '';
						bVal = b.originallyAvailableAt || '';
						break;
					case 'year':
						aVal = a.year || 0;
						bVal = b.year || 0;
						break;
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
			'X-Plex-Device-Name': 'Plexman Web'
		};

		try {
			const response = await fetch(
				`${serverUrl}/library/sections/${libraryId}/all?` +
					new URLSearchParams({
						type: type === 'show' ? '2' : '1',
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

	function calculatePercentile(value: number, allValues: number[]): number {
		if (allValues.length === 0) return 0;
		const sorted = [...allValues].sort((a, b) => a - b);
		const index = sorted.indexOf(value);
		return Math.round((index / (sorted.length - 1)) * 100);
	}

	// Calculate all sizes and bitrates for percentiles
	$: allSizes = media
		.flatMap((item) => item.Media?.map((m: MediaItem) => m?.Part?.[0]?.size || 0) || [])
		.filter((size) => size > 0);
	$: allOverallBitrates = media
		.flatMap((item) => item.Media?.map((m: MediaItem) => m?.bitrate || 0) || [])
		.filter((br) => br > 0);
	$: allVideoBitrates = media
		.flatMap(
			(item) =>
				item.Media?.map((m: MediaItem) => {
					const detailed = detailedMedia.get(item.ratingKey);
					return (
						detailed?.Media?.[0]?.Part?.[0]?.Stream?.find((s: Stream) => s.streamType === 1)
							?.bitrate ||
						m?.Part?.[0]?.Stream?.find((s: Stream) => s.streamType === 1)?.bitrate ||
						0
					);
				}) || []
		)
		.filter((br) => br > 0);

	function getPercentiles(size: number, overallBitrate: number) {
		return {
			sizePercentile: calculatePercentile(size, allSizes),
			overallBitratePercentile: calculatePercentile(overallBitrate, allOverallBitrates)
		};
	}

	function formatBitrate(bitrate: number): string {
		const item = media.find((m) => m.Media?.[0]?.bitrate === bitrate);
		if (!item) return `${bitrate} Kbps`;

		const mediaInfo = item.Media?.[0];
		if (!mediaInfo) return `${bitrate} Kbps`;

		const streams = mediaInfo.Part?.[0]?.Stream;
		if (!streams) return `${bitrate} Kbps`;

		// Get video stream bitrate directly from API
		const videoStream = streams.find((s: Stream) => s.streamType === 1);
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

	function handleLogout() {
		localStorage.removeItem('plexToken');
		localStorage.removeItem('plexClientId');
		goto('/login');
	}

	function handleSortSelect(event: Event) {
		const select = event.target as HTMLSelectElement;
		const option = SORT_OPTIONS[select.selectedIndex];
		sortField = option.field;
		sortDirection = option.direction;
		sortFieldStore.set(option.field);
		sortDirectionStore.set(option.direction);
	}

	onMount(() => {
		fetchMedia();
		fetchLibraries();
	});
</script>

<div class="min-h-screen bg-gray-100">
	<Header {libraries} />

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
			<div class="mb-2 flex gap-2">
				<div class="relative flex-1">
					<input
						type="text"
						bind:value={searchInput}
						on:input={() => debounceSearch(searchInput)}
						placeholder={type === 'show' ? 'Search TV shows...' : 'Search movies...'}
						class="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
					/>
					{#if searchInput}
						<button
							on:click={() => {
								searchInput = '';
								searchQuery.set('');
							}}
							class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4"
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
				{#if type === 'movie'}
					<select
						on:change={handleSortSelect}
						class="px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-orange-500 focus:border-orange-500 bg-white"
					>
						{#each SORT_OPTIONS as option}
							<option selected={sortField === option.field && sortDirection === option.direction}>
								{option.label}
							</option>
						{/each}
					</select>
				{/if}
			</div>

			{#if type === 'movie'}
				<div class="mb-4 flex flex-wrap gap-2">
					<button
						class="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700"
						on:click={() => qualityFilter.update((v) => (v === '90p+' ? null : '90p+'))}
					>
						<span class="text-green-500">★★★★</span>
					</button>
					<button
						class="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700"
						on:click={() => qualityFilter.update((v) => (v === '75-89p' ? null : '75-89p'))}
					>
						<span class="text-green-500">●●●●</span>
					</button>
					<button
						class="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700"
						on:click={() => qualityFilter.update((v) => (v === '50-74p' ? null : '50-74p'))}
					>
						<span class="text-teal-500">●●●○</span>
					</button>
					<button
						class="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700"
						on:click={() => qualityFilter.update((v) => (v === '25-49p' ? null : '25-49p'))}
					>
						<span class="text-orange-500">●○○○</span>
					</button>
					<button
						class="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700"
						on:click={() => qualityFilter.update((v) => (v === '<25p' ? null : '<25p'))}
					>
						<span class="text-red-500">●○○○</span>
					</button>
					<button
						class="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700"
						on:click={() => showMultiFileOnly.update((v) => !v)}
					>
						Multiple Files
					</button>
				</div>
			{/if}

			<div class="bg-white shadow-sm rounded-lg overflow-hidden">
				<div class="overflow-x-auto">
					{#if type === 'movie'}
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
										<button
											type="button"
											class="w-full text-left hover:bg-gray-100"
											on:click={() => handleSort('year')}
											on:keydown={(e) => e.key === 'Enter' && handleSort('year')}
										>
											Year
											{#if sortField === 'year'}
												<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
											{/if}
										</button>
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
											<button
												type="button"
												class="w-14 cursor-pointer hover:bg-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
												on:click={() => handleSort('overallBitrate')}
												on:keydown={(e) => e.key === 'Enter' && handleSort('overallBitrate')}
											>
												Overall
												{#if sortField === 'overallBitrate'}
													<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
												{/if}
											</button>
											<button
												type="button"
												class="w-14 cursor-pointer hover:bg-gray-100 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
												on:click={() => handleSort('videoBitrate')}
												on:keydown={(e) => e.key === 'Enter' && handleSort('videoBitrate')}
											>
												Video
												{#if sortField === 'videoBitrate'}
													<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
												{/if}
											</button>
											<div class="w-14">Audio</div>
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
										{getPercentiles}
									/>
								{/each}
							</tbody>
						</table>
					{:else}
						<div
							class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2 p-2"
						>
							{#each $filteredMedia as show (show.ratingKey)}
								<ShowRow {show} {libraryId} />
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</main>
</div>
