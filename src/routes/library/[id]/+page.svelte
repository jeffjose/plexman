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

	// Change media to a writable store
	const mediaStore = writable<PlexItem[]>([]);
	// Remove the old let media declaration
	// let media: PlexItem[] = [];

	let loading = true;
	let error: string | null = null;
	let sortField = 'addedAt';
	let sortDirection = 'desc';
	let libraries: any[] = [];
	let allSizes: number[] = [];
	let allOverallBitrates: number[] = [];
	let allVideoBitrates: number[] = [];
	let libraryType: 'movie' | 'show' | null = null;

	const SORT_OPTIONS = [
		{ label: 'Recently Added ↓', field: 'addedAt', direction: 'desc' },
		{ label: 'Recently Added ↑', field: 'addedAt', direction: 'asc' },
		{ label: 'Release Date ↓', field: 'originallyAvailableAt', direction: 'desc' },
		{ label: 'Release Date ↑', field: 'originallyAvailableAt', direction: 'asc' },
		{ label: 'Title A-Z', field: 'title', direction: 'asc' },
		{ label: 'Title Z-A', field: 'title', direction: 'desc' }
	];

	// Initialize stores with values from URL
	const searchQuery = writable($page.url.searchParams.get('search') || '');
	const qualityFilter = writable<string | null>($page.url.searchParams.get('quality') || null);
	const showMultiFileOnly = writable($page.url.searchParams.get('multifile') === 'true');
	const sortFieldStore = writable($page.url.searchParams.get('sort') || sortField);
	const sortDirectionStore = writable($page.url.searchParams.get('direction') || sortDirection);

	let searchInput = $page.url.searchParams.get('search') || '';
	let searchTimeout: ReturnType<typeof setTimeout>;

	// Update URL when filters change
	onMount(() => {
		// Subscribe to store changes and update URL
		const unsubscribe = derived(
			[searchQuery, qualityFilter, showMultiFileOnly, sortFieldStore, sortDirectionStore],
			([
				$searchQuery,
				$qualityFilter,
				$showMultiFileOnly,
				$sortFieldStore,
				$sortDirectionStore
			]) => {
				const url = new URL(window.location.href);

				if ($searchQuery) url.searchParams.set('search', $searchQuery);
				else url.searchParams.delete('search');

				if ($qualityFilter) url.searchParams.set('quality', $qualityFilter);
				else url.searchParams.delete('quality');

				if ($showMultiFileOnly) url.searchParams.set('multifile', 'true');
				else url.searchParams.delete('multifile');

				if ($sortFieldStore !== 'addedAt') url.searchParams.set('sort', $sortFieldStore);
				else url.searchParams.delete('sort');

				if ($sortDirectionStore !== 'desc') url.searchParams.set('direction', $sortDirectionStore);
				else url.searchParams.delete('direction');

				if (url.toString() !== window.location.href) {
					history.replaceState(null, '', url);
				}
			}
		).subscribe(() => {});

		// Clean up subscription on component unmount
		return () => unsubscribe();
	});

	function debounceSearch(value: string) {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchQuery.set(value);
		}, 250);
	}

	// Reactive libraryId from route param
	$: libraryId = $page.params.id;

	// Fetch libraries once on initial mount
	onMount(async () => {
		await fetchLibraries();
		// Initial media fetch is handled by the reactive block below once libraries load
	});

	// Reactive block to fetch media when libraryId changes OR libraries load
	$: {
		if (libraryId && libraries.length > 0) {
			const currentLibrary = libraries.find((lib) => lib.key === libraryId);
			const currentLibraryType =
				currentLibrary?.type === 'movie'
					? 'movie'
					: currentLibrary?.type === 'show'
						? 'show'
						: null;

			if (currentLibraryType) {
				// console.log(`Library ID ${libraryId} changed or libraries loaded. Type: ${currentLibraryType}. Fetching...`);
				// Immediately set loading state and clear old data
				loading = true;
				mediaStore.set([]); // Clear the store
				error = null;
				fetchMedia(libraryId, currentLibraryType);
			} else {
				// Handle case where library exists but type is unknown/unsupported
				loading = false;
				error = `Library ${libraryId} has an unsupported type: ${currentLibrary?.type}`;
				mediaStore.set([]); // Clear the store
			}
		} else if (libraryId && libraries.length === 0) {
			// Libraries haven't loaded yet, remain in loading state or handle appropriately
			// loading = true; // Already true by default or set by previous navigation
		} else {
			// Initial state before libraryId is set or if libraryId is invalid
			loading = false;
			mediaStore.set([]); // Clear the store
			error = 'Invalid Library ID.';
		}
	}

	const filteredMedia = derived(
		[mediaStore, searchQuery, sortFieldStore, sortDirectionStore, qualityFilter, showMultiFileOnly],
		([
			$mediaStore,
			$searchQuery,
			$sortField,
			$sortDirection,
			$qualityFilter,
			$showMultiFileOnly
		]) => {
			// Start with the original media list from the store
			let result = $mediaStore; // Use $mediaStore here

			// Apply search filter if there's a query
			if ($searchQuery) {
				result = result.filter((item) => {
					const searchLower = $searchQuery.toLowerCase();
					return (
						item.title.toLowerCase().includes(searchLower) ||
						(item.originalTitle || '').toLowerCase().includes(searchLower)
					);
				});
			}

			// Apply quality filter if selected
			if ($qualityFilter) {
				// IMPORTANT: Need to filter based on the *original* store value,
				// not the potentially already search-filtered 'result'
				// Or, chain the filters correctly. Let's chain them.
				result = result.filter((item) => {
					// Filter the current result set
					const mediaInfo = item.Media?.[0];
					if (!mediaInfo) return false;

					const size = mediaInfo.Part?.[0]?.size || 0;
					const bitrate = mediaInfo.bitrate || 0;
					const { overallBitratePercentile } = getPercentiles(size, bitrate);

					switch ($qualityFilter) {
						case '90p+':
							return overallBitratePercentile >= 90;
						case '75-89p':
							return overallBitratePercentile >= 75 && overallBitratePercentile < 90;
						case '50-74p':
							return overallBitratePercentile >= 50 && overallBitratePercentile < 75;
						case '25-49p':
							return overallBitratePercentile >= 25 && overallBitratePercentile < 50;
						case '<25p':
							return overallBitratePercentile < 25;
						default:
							return true;
					}
				});
			}

			// Apply multi-file filter if selected
			if ($showMultiFileOnly) {
				// IMPORTANT: Same as above, filter the current result set
				result = result.filter((item) => {
					// Filter the current result set
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

	// Modify fetchMedia to accept id and type
	async function fetchMedia(id: string, type: 'movie' | 'show') {
		// Set loading state (might be redundant if called from reactive block, but safe)
		loading = true;
		error = null;

		const token = localStorage.getItem('plexToken');
		const clientId = localStorage.getItem('plexClientId');
		const serverUrl = localStorage.getItem('plexServerUrl');

		if (!token || !clientId || !serverUrl) {
			goto('/login');
			loading = false; // Ensure loading stops if redirecting
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
			// Use passed id and type
			const response = await fetch(
				`${serverUrl}/library/sections/${id}/all?` +
					new URLSearchParams({
						type: type === 'show' ? '2' : '1',
						includeExternalMedia: '1',
						includePreferences: '1',
						checkFiles: '1', // Consider if these params are needed every time
						asyncCheckFiles: '0'
						// Filter/sort params from stores - Note: derived stores ($store) cannot be used directly here
						// You might need to pass these as arguments too, or fetch unfiltered and rely on client-side filtering
						// For now, removing server-side filtering based on stores from fetchMedia
						// ...($qualityFilter ? { 'label!': $qualityFilter } : {}),
						// ...($showMultiFileOnly ? { 'Media.Part>': '1' } : {}),
						// ...($searchQuery ? { title: $searchQuery } : {})
					}),
				{ headers }
			);

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData?.errors?.[0]?.message || 'Failed to fetch media');
			}

			const data = await response.json();
			// Assign fetched data to the store
			mediaStore.set(data.MediaContainer.Metadata || []);
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
			mediaStore.set([]); // Clear media store on error
			if (error.includes('X-Plex-Token is missing') || error.includes('invalid')) {
				localStorage.removeItem('plexToken');
				goto('/login');
			}
		} finally {
			loading = false;
		}
	}

	// fetchLibraries remains the same, just fetches libraries
	async function fetchLibraries() {
		const token = localStorage.getItem('plexToken');
		const clientId = localStorage.getItem('plexClientId');
		const serverUrl = localStorage.getItem('plexServerUrl');

		if (!token || !clientId || !serverUrl) {
			// Don't goto login here, might interfere with initial load
			console.error('Auth details missing for fetchLibraries');
			error = 'Authentication details missing.';
			libraries = []; // Ensure libraries is empty
			loading = false;
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
			libraries = data.MediaContainer.Directory || [];
		} catch (e) {
			console.error('Failed to fetch libraries:', e);
			error = e instanceof Error ? e.message : 'Failed to load libraries.';
			libraries = []; // Ensure libraries is empty on error
			loading = false; // Stop loading if libraries fail
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

	// Calculate all sizes and bitrates for percentiles based on the store
	$: allSizes = ($mediaStore || [])
		.flatMap((item) => item.Media?.map((m: MediaItem) => m?.Part?.[0]?.size || 0) || [])
		.filter((size) => size > 0);
	$: allOverallBitrates = ($mediaStore || [])
		.flatMap((item) => item.Media?.map((m: MediaItem) => m?.bitrate || 0) || [])
		.filter((br) => br > 0);
	$: allVideoBitrates = ($mediaStore || [])
		.flatMap((item) =>
			($mediaStore || []) // Use $mediaStore here too for consistency
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
				.filter((br) => br > 0)
		)
		.filter((br) => br > 0);

	function getPercentiles(size: number, overallBitrate: number) {
		return {
			sizePercentile: calculatePercentile(size, allSizes),
			overallBitratePercentile: calculatePercentile(overallBitrate, allOverallBitrates)
		};
	}

	function formatBitrate(bitrate: number): string {
		// Find item in the store
		const item = ($mediaStore || []).find((m) => m.Media?.[0]?.bitrate === bitrate);
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
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center space-x-4">
					<input
						type="text"
						placeholder="Search movies..."
						bind:value={$searchQuery}
						class="px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-orange-500 focus:border-orange-500 bg-white"
					/>
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
					<a
						href="/library/{libraryId}/stats"
						class="px-3 py-1.5 text-sm font-medium rounded-md bg-orange-500 text-white hover:bg-orange-600"
					>
						View Stats
					</a>
				</div>
			</div>

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
					<span class="text-orange-500">●●○○</span>
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

			{@const renderType = libraries.find((lib) => lib.key === libraryId)?.type}
			{#if renderType === 'show'}
				<div
					class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2"
				>
					{#each $filteredMedia as item (item.ratingKey)}
						<ShowRow show={item} {libraryId} />
					{/each}
				</div>
			{:else if renderType === 'movie'}
				<div class="bg-white shadow-sm rounded-lg overflow-hidden">
					<div class="overflow-x-auto">
						<table class="min-w-full divide-y divide-gray-200">
							<thead class="bg-gray-50">
								<tr>
									<th class="px-1 py-1 w-12"></th>
									<th
										class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
									>
										Title ({$filteredMedia.length})
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
					</div>
				</div>
			{/if}
		{/if}
	</main>
</div>
