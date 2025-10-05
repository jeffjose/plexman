<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { writable, derived, type Readable, get } from 'svelte/store';
	import Header from '../../../components/Header.svelte';
	import MovieRow from './MovieRow.svelte';
	import ShowRow from './ShowRow.svelte';

	// Access server data
	$: ({ plexToken, plexServerUrl } = $page.data);

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
		addedAt: number; // Assuming it's a timestamp number
		Media?: MediaItem[];
		[key: string]: any; // Allow any string key for dynamic access
	}

	const mediaStore = writable<PlexItem[]>([]);
	const librariesStore = writable<any[]>([]);
	const detailedMediaStore = writable<Map<string, any>>(new Map());
	const errorStore = writable<string | null>(null);
	const loadingStore = writable(true);

	let libraryType: 'movie' | 'show' | null = null;

	const searchQuery = writable($page.url.searchParams.get('search') || '');
	const qualityFilter = writable<string | null>($page.url.searchParams.get('quality') || null);
	const showMultiFileOnly = writable($page.url.searchParams.get('multifile') === 'true');
	const sortFieldStore = writable($page.url.searchParams.get('sort') || 'addedAt');
	const sortDirectionStore = writable($page.url.searchParams.get('direction') || 'desc');

	let searchInput = $page.url.searchParams.get('search') || '';
	let searchTimeout: ReturnType<typeof setTimeout>;

	$: libraryId = $page.params.id;

	$: libraryType = $librariesStore.find((lib) => lib.key === libraryId)?.type || null;

	const allSizesStore: Readable<number[]> = derived(mediaStore, ($mediaStore) =>
		($mediaStore || [])
			.flatMap((item) => item.Media?.map((m: MediaItem) => m?.Part?.[0]?.size || 0) || [])
			.filter((size) => size > 0)
	);
	const allOverallBitratesStore: Readable<number[]> = derived(mediaStore, ($mediaStore) =>
		($mediaStore || [])
			.flatMap((item) => item.Media?.map((m: MediaItem) => m?.bitrate || 0) || [])
			.filter((br) => br > 0)
	);
	const allVideoBitratesStore: Readable<number[]> = derived(mediaStore, ($mediaStore) =>
		($mediaStore || [])
			.flatMap(
				(item) =>
					item.Media?.flatMap(
						(m: MediaItem) =>
							m?.Part?.flatMap(
								(p: MediaPart) =>
									p?.Stream?.filter((s: Stream) => s.streamType === 1).map((s) => s.bitrate || 0) ||
									[]
							) || []
					) || []
			)
			.filter((br) => br > 0)
	);

	async function fetchLibraries() {
		try {
			if (!plexServerUrl || !plexToken) {
				throw new Error('Not authenticated');
			}
			const response = await fetch(
				`${plexServerUrl}/library/sections?X-Plex-Token=${plexToken}`
			);
			if (!response.ok) {
				let errorMsg = 'Failed to fetch libraries';
				try {
					const errorData = await response.json();
					errorMsg = errorData?.message || errorData?.error || errorMsg;
				} catch (_) {}
				if (response.status === 401) goto('/login');
				throw new Error(`${errorMsg} (Status: ${response.status})`);
			}
			const data = await response.json();
			librariesStore.set(data.MediaContainer.Directory || []);
			errorStore.set(null);
		} catch (e: any) {
			console.error('Failed to fetch libraries:', e);
			librariesStore.set([]);
			errorStore.set(e.message || 'Failed to load libraries.');
		}
	}

	async function fetchMedia(id: string, type: 'movie' | 'show') {
		if (!id || !type) return;
		loadingStore.set(true);
		errorStore.set(null);
		try {
			if (!plexServerUrl || !plexToken) {
				throw new Error('Not authenticated');
			}
			const params = new URLSearchParams({
				type: type === 'show' ? '2' : '1',
				includeExternalMedia: '1',
				includePreferences: '1',
				'X-Plex-Token': plexToken
			});
			const response = await fetch(`${plexServerUrl}/library/sections/${id}/all?${params.toString()}`);

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
			mediaStore.set(data.MediaContainer.Metadata || []);
		} catch (e: any) {
			console.error('Failed to fetch media:', e);
			errorStore.set(e.message || 'An error occurred fetching media.');
			mediaStore.set([]);
		} finally {
			loadingStore.set(false);
		}
	}

	async function fetchDetailedMedia(ratingKey: string) {
		if (!ratingKey || $detailedMediaStore.has(ratingKey)) return;

		try {
			if (!plexServerUrl || !plexToken) return;
			const params = new URLSearchParams({
				includeExternalMedia: '1',
				includePreferences: '1',
				'X-Plex-Token': plexToken
			});
			const response = await fetch(`${plexServerUrl}/library/metadata/${ratingKey}?${params.toString()}`);

			if (!response.ok) {
				console.warn(`Failed to fetch detailed metadata for ${ratingKey}: ${response.status}`);
				return;
			}
			const data = await response.json();
			if (data.MediaContainer.Metadata && data.MediaContainer.Metadata.length > 0) {
				detailedMediaStore.update((map) => {
					map.set(ratingKey, data.MediaContainer.Metadata[0]);
					return map;
				});
			}
		} catch (e) {
			console.error(`Error fetching detailed metadata for ${ratingKey}:`, e);
		}
	}

	const filteredAndSortedMedia: Readable<PlexItem[]> = derived(
		[
			mediaStore,
			detailedMediaStore,
			searchQuery,
			qualityFilter,
			showMultiFileOnly,
			sortFieldStore,
			sortDirectionStore,
			allSizesStore,
			allOverallBitratesStore,
			allVideoBitratesStore
		],
		([
			$mediaStore,
			$detailedMediaStore,
			$searchQuery,
			$qualityFilter,
			$showMultiFileOnly,
			$sortField,
			$sortDirection,
			$allSizes,
			$allOverallBitrates,
			$allVideoBitrates
		]) => {
			let result = $mediaStore || [];

			// --- Pre-calculate percentiles if quality filter is active ---
			let overallBitratePercentiles = new Map<string, number>();
			if ($qualityFilter && $allOverallBitrates.length > 0) {
				result.forEach((item) => {
					const overallBitrate = item.Media?.[0]?.bitrate || 0;
					overallBitratePercentiles.set(
						item.ratingKey,
						calculatePercentile(overallBitrate, $allOverallBitrates)
					);
				});
			}
			// -----------------------------------------------------------

			if ($searchQuery) {
				const query = $searchQuery.toLowerCase();
				result = result.filter(
					(item: PlexItem) =>
						item.title?.toLowerCase().includes(query) ||
						item.originalTitle?.toLowerCase().includes(query)
				);
			}

			if ($qualityFilter) {
				result = result.filter((item: PlexItem) => {
					const overallBitratePercentile = overallBitratePercentiles.get(item.ratingKey) || 0;
					switch ($qualityFilter) {
						case '90p':
							return overallBitratePercentile >= 90;
						case '75p':
							return overallBitratePercentile >= 75 && overallBitratePercentile < 90;
						case '50p':
							return overallBitratePercentile >= 50 && overallBitratePercentile < 75;
						case '25p':
							return overallBitratePercentile >= 25 && overallBitratePercentile < 50;
						case '<25p':
							return overallBitratePercentile < 25;
						default:
							return true;
					}
				});
			}

			if ($showMultiFileOnly) {
				result = result.filter((item: PlexItem) => item.Media && item.Media.length > 1);
			}

			return [...result].sort((a: PlexItem, b: PlexItem) => {
				let aVal: any;
				let bVal: any;

				const aDetailed = $detailedMediaStore.get(a.ratingKey);
				const bDetailed = $detailedMediaStore.get(b.ratingKey);

				switch ($sortField) {
					case 'overallBitrate':
						aVal = a.Media?.[0]?.bitrate || 0;
						bVal = b.Media?.[0]?.bitrate || 0;
						break;
					case 'videoBitrate':
						aVal = getVideoBitrate(aDetailed || a);
						bVal = getVideoBitrate(bDetailed || b);
						break;
					case 'fileSize':
						aVal = a.Media?.[0]?.Part?.[0]?.size || 0;
						bVal = b.Media?.[0]?.Part?.[0]?.size || 0;
						break;
					case 'addedAt':
						aVal = a.addedAt || 0;
						bVal = b.addedAt || 0;
						break;
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
				if (typeof aVal === 'string' && typeof bVal === 'string') {
					return $sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
				}
				return 0;
			});
		}
	);

	onMount(() => {
		fetchLibraries();

		const unsubscribeDerived = derived(
			[searchQuery, qualityFilter, showMultiFileOnly, sortFieldStore, sortDirectionStore],
			([$search, $quality, $multi, $sort, $direction]) => {
				const currentUrl = new URL(window.location.href);
				const params = currentUrl.searchParams;

				const updateParam = (key: string, value: string | null | boolean, defaultValue?: any) => {
					if (value != null && value !== false && value !== defaultValue) {
						params.set(key, String(value));
					} else {
						params.delete(key);
					}
				};

				updateParam('search', $search, '');
				updateParam('quality', $quality, null);
				updateParam('multifile', $multi, false);
				updateParam('sort', $sort, 'addedAt');
				updateParam('direction', $direction, 'desc');

				if (currentUrl.search !== params.toString()) {
					currentUrl.search = params.toString();
					history.replaceState(null, '', currentUrl);
				}
			}
		).subscribe(() => {});

		const unsubscribePage = page.subscribe(($page) => {
			const newLibraryId = $page.params.id;
			const currentLibraryType = $librariesStore.find((lib) => lib.key === newLibraryId)?.type;
			if (newLibraryId && currentLibraryType) {
				fetchMedia(newLibraryId, currentLibraryType);
			}
		});

		return () => {
			unsubscribeDerived();
			unsubscribePage();
			clearTimeout(searchTimeout);
		};
	});

	$: if (libraryId && libraryType) {
		fetchMedia(libraryId, libraryType);
	}

	function debounceSearch(value: string) {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchQuery.set(value);
		}, 300);
	}

	function handleSort(field: string) {
		const currentSort = $sortFieldStore;
		const currentDirection = $sortDirectionStore;
		if (currentSort === field) {
			const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
			sortDirectionStore.set(newDirection);
		} else {
			sortFieldStore.set(field);
			sortDirectionStore.set('desc');
		}
	}

	function calculatePercentile(value: number, allValues: number[]): number {
		if (allValues.length === 0 || value === 0) return 0;
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

	function getVideoBitrate(item: PlexItem | null | undefined): number {
		return (
			item?.Media?.[0]?.Part?.[0]?.Stream?.find((s: Stream) => s.streamType === 1)?.bitrate || 0
		);
	}

	function formatDurationSimple(ms: number): string {
		if (!ms || ms <= 0) return '00:00';
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		let result = '';
		if (hours > 0) {
			result += `${hours.toString().padStart(2, '0')}:`;
		}
		result += `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		return result;
	}

	function formatFileSizeSimple(bytes: number): string {
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

	const SORT_OPTIONS = [
		{ label: 'Added ↓', field: 'addedAt', direction: 'desc' },
		{ label: 'Added ↑', field: 'addedAt', direction: 'asc' },
		{ label: 'Released ↓', field: 'originallyAvailableAt', direction: 'desc' },
		{ label: 'Released ↑', field: 'originallyAvailableAt', direction: 'asc' },
		{ label: 'Title A-Z', field: 'title', direction: 'asc' },
		{ label: 'Title Z-A', field: 'title', direction: 'desc' },
		{ label: 'Size ↓', field: 'fileSize', direction: 'desc' },
		{ label: 'Size ↑', field: 'fileSize', direction: 'asc' },
		{ label: 'Bitrate ↓', field: 'overallBitrate', direction: 'desc' },
		{ label: 'Bitrate ↑', field: 'overallBitrate', direction: 'asc' }
	];

	const QUALITY_FILTERS = [
		{ label: 'All Qualities', value: null },
		{ label: 'Top 10% (>=90p)', value: '90p' },
		{ label: '75p - 89p', value: '75p' },
		{ label: '50p - 74p', value: '50p' },
		{ label: '25p - 49p', value: '25p' },
		{ label: '<25p', value: '<25p' }
	];
</script>

<svelte:head>
	<title>{$librariesStore.find((l) => l.key === libraryId)?.title || 'Library'} - Plexman</title>
</svelte:head>

<div class="min-h-screen bg-gray-100">
	<Header libraries={$librariesStore} />

	<main class="w-full px-4 py-4">
		{#if $loadingStore}
			<div class="flex justify-center items-center h-64">
				<div
					class="w-12 h-12 border-t-4 border-orange-500 border-solid rounded-full animate-spin"
				></div>
			</div>
		{:else if $errorStore}
			<div
				class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative"
				role="alert"
			>
				<strong class="font-bold">Error!</strong>
				<span class="block sm:inline">{$errorStore}</span>
			</div>
		{:else}
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center space-x-4">
					<input
						type="text"
						placeholder="Search title..."
						bind:value={searchInput}
						on:input={(e) => debounceSearch(e.currentTarget.value)}
						class="px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-orange-500 focus:border-orange-500 bg-white"
					/>
					<select
						on:change={(e) => {
							const option = SORT_OPTIONS[e.currentTarget.selectedIndex];
							sortFieldStore.set(option.field);
							sortDirectionStore.set(option.direction);
						}}
						class="px-3 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-orange-500 focus:border-orange-500 bg-white"
					>
						{#each SORT_OPTIONS as option}
							<option
								selected={$sortFieldStore === option.field &&
									$sortDirectionStore === option.direction}
							>
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
				<span class="text-sm text-gray-500"
					>{$filteredAndSortedMedia.length} / {$mediaStore.length} items</span
				>
			</div>

			<div class="mb-4 flex flex-wrap gap-2">
				{#each QUALITY_FILTERS as filter}
					<button
						class:bg-orange-100={$qualityFilter === filter.value}
						class:text-orange-700={$qualityFilter === filter.value}
						class="px-3 py-1 text-xs font-medium rounded-md border border-gray-200 hover:bg-gray-50 {$qualityFilter ===
						filter.value
							? ''
							: 'bg-white text-gray-700'}"
						on:click={() =>
							qualityFilter.set($qualityFilter === filter.value ? null : filter.value)}
						title={filter.label}
					>
						{#if filter.value === '90p'}
							<span class="text-green-500">★★★★</span>
						{:else if filter.value === '75p'}
							<span class="text-green-500">●●●●</span>
						{:else if filter.value === '50p'}
							<span class="text-teal-500">●●●○</span>
						{:else if filter.value === '25p'}
							<span class="text-orange-500">●●○○</span>
						{:else if filter.value === '<25p'}
							<span class="text-red-500">●○○○</span>
						{:else}
							All Qualities
						{/if}
					</button>
				{/each}
				<button
					class="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 {$showMultiFileOnly
						? 'bg-orange-100 text-orange-700'
						: 'bg-white text-gray-700'} hover:bg-gray-50"
					on:click={() => showMultiFileOnly.update((v) => !v)}
				>
					Multiple Files Only
				</button>
			</div>

			{#if libraryType === 'movie'}
				<div class="bg-white shadow overflow-visible sm:rounded-md">
					<div class="min-w-full">
						<div
							class="bg-gray-50 grid grid-cols-[48px_1fr_56px_80px_112px_96px] gap-2 px-2 py-1 sticky top-0 z-10 border-b border-gray-200"
						>
							<div class="px-1 py-1"></div>
							<div
								class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>
								Title ({$filteredAndSortedMedia.length})
							</div>
							<div
								class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>
								<button
									type="button"
									class="w-full text-left hover:bg-gray-100 flex items-center"
									on:click={() => handleSort('year')}
									on:keydown={(e) => e.key === 'Enter' && handleSort('year')}
								>
									Year
									{#if $sortFieldStore === 'year'}
										<span class="ml-1">{$sortDirectionStore === 'asc' ? '↑' : '↓'}</span>
									{/if}
								</button>
							</div>
							<div
								class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>
								Duration
							</div>
							<div
								class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>
								Details
							</div>
							<div
								class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>
								<!-- spacer -->
							</div>
						</div>
						<div class="bg-white">
							{#each $filteredAndSortedMedia as item (item.ratingKey)}
								<MovieRow
									{item}
									detailedMedia={$detailedMediaStore}
									onDebug={(itemForDebug) => fetchDetailedMedia(itemForDebug.ratingKey)}
									formatDuration={formatDurationSimple}
									formatFileSize={formatFileSizeSimple}
									allSizes={$allSizesStore}
									allOverallBitrates={$allOverallBitratesStore}
									calculatePercentileFn={calculatePercentile}
								/>
							{/each}
						</div>
					</div>
				</div>
			{:else if libraryType === 'show'}
				<div
					class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3"
				>
					{#each $filteredAndSortedMedia as item (item.ratingKey)}
						<ShowRow show={item} {libraryId} />
					{/each}
				</div>
			{/if}

			{#if $filteredAndSortedMedia.length === 0 && $mediaStore.length > 0}
				<div class="text-center py-12">
					<p class="text-sm text-gray-500">No items match your current filters.</p>
				</div>
			{/if}
		{/if}
	</main>
</div>
