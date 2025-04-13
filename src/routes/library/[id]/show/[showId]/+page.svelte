<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { writable, derived } from 'svelte/store';
	import MovieRow from '../../MovieRow.svelte';
	import Header from '../../../../../components/Header.svelte';

	// --- Interfaces ---
	interface Stream {
		streamType: number;
		codec?: string;
		bitrate?: number;
		channels?: number;
		height?: number;
		[key: string]: any;
	}

	interface PlexItem {
		// Define needed properties for show and episode
		ratingKey: string;
		title: string;
		[key: string]: any; // Allow other properties
	}

	// --- State ---
	let show: PlexItem | null = null;
	let episodes: PlexItem[] = [];
	let loading = true;
	let error: string | null = null;
	let libraries: any[] = [];
	let detailedMedia = writable<Map<string, any>>(new Map()); // Use writable store
	let observers = new Map<string, IntersectionObserver>();

	// --- Filtering/Sorting State ---
	const searchQuery = writable('');
	const sortFieldStore = writable('index'); // Default sort for episodes
	const sortDirectionStore = writable('asc');
	let searchInput = '';
	let searchTimeout: ReturnType<typeof setTimeout>;

	// --- Reactive ---
	$: libraryId = $page.params.id;
	$: showId = $page.params.showId;

	// --- Helper Functions ---
	function debounceSearch(value: string) {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchQuery.set(value);
		}, 300);
	}

	function formatDuration(ms: number): string {
		if (!ms || ms <= 0) return '00:00:00';
		const hours = Math.floor(ms / 3600000);
		const minutes = Math.floor((ms % 3600000) / 60000);
		const seconds = Math.floor((ms % 60000) / 1000);
		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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

	// --- Data Fetching ---
	async function fetchLibraries() {
		try {
			const response = await fetch(`/api/plex/library/sections`);
			if (!response.ok) {
				console.warn(`Failed to fetch libraries for header: ${response.status}`);
				return; // Don't throw, header might just be incomplete
			}
			const data = await response.json();
			libraries = data.MediaContainer.Directory || [];
		} catch (e) {
			console.error('Failed to fetch libraries:', e);
			libraries = [];
		}
	}

	async function fetchShowAndEpisodes() {
		if (!showId) return;
		loading = true;
		error = null;
		try {
			// Fetch show details
			const showResponse = await fetch(`/api/plex/library/metadata/${showId}?includeChildren=1`);
			if (!showResponse.ok) {
				let errorMsg = 'Failed to fetch show details';
				try {
					const errData = await showResponse.json();
					errorMsg = errData?.message || errData?.error || errorMsg;
				} catch (_) {}
				if (showResponse.status === 401) goto('/login');
				throw new Error(`${errorMsg} (Status: ${showResponse.status})`);
			}
			const showData = await showResponse.json();
			show = showData.MediaContainer.Metadata[0];

			// Fetch all episodes
			const episodesParams = new URLSearchParams({
				includeExternalMedia: '1'
			});
			const episodesResponse = await fetch(
				`/api/plex/library/metadata/${showId}/allLeaves?${episodesParams.toString()}`
			);
			if (!episodesResponse.ok) {
				let errorMsg = 'Failed to fetch episodes';
				try {
					const errData = await episodesResponse.json();
					errorMsg = errData?.message || errData?.error || errorMsg;
				} catch (_) {}
				if (episodesResponse.status === 401) goto('/login');
				throw new Error(`${errorMsg} (Status: ${episodesResponse.status})`);
			}
			const episodesData = await episodesResponse.json();
			episodes = episodesData.MediaContainer.Metadata || [];
		} catch (e: any) {
			console.error('Failed to fetch show/episodes:', e);
			episodes = [];
			show = null;
			error = e.message || 'An error occurred loading the show.';
		} finally {
			loading = false;
		}
	}

	// Fetch detailed metadata for an episode when it becomes visible
	async function fetchDetailedEpisode(episode: PlexItem) {
		const ratingKey = episode.ratingKey;
		if (!ratingKey || $detailedMedia.has(ratingKey)) return;

		try {
			const params = new URLSearchParams({
				includeExternalMedia: '1'
			});
			const response = await fetch(`/api/plex/library/metadata/${ratingKey}?${params.toString()}`);
			if (!response.ok) {
				console.warn(
					`Failed to fetch detailed metadata for episode ${ratingKey}: ${response.status}`
				);
				return;
			}
			const data = await response.json();
			if (data.MediaContainer.Metadata && data.MediaContainer.Metadata.length > 0) {
				detailedMedia.update((map) => {
					map.set(ratingKey, data.MediaContainer.Metadata[0]);
					return map;
				});
			}
		} catch (e) {
			console.error(`Error fetching detailed metadata for episode ${ratingKey}:`, e);
		}
	}

	// --- Intersection Observer for lazy-loading detailed data ---
	function createObserver(episode: PlexItem) {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						fetchDetailedEpisode(episode);
						observer.unobserve(entry.target); // Stop observing once triggered
						observers.delete(episode.ratingKey);
					}
				});
			},
			{ threshold: 0.1 } // Trigger when 10% visible
		);
		return observer;
	}

	function observeEpisode(element: HTMLElement, episode: PlexItem) {
		if (!element || observers.has(episode.ratingKey)) return;

		// Only observe if detailed data isn't already loading/loaded
		if (!$detailedMedia.has(episode.ratingKey)) {
			const observer = createObserver(episode);
			observers.set(episode.ratingKey, observer);
			observer.observe(element);
			// console.log(`Observing episode: ${episode.title}`);
		}
	}

	// --- Filtering & Sorting Episodes ---
	const filteredAndSortedEpisodes = derived(
		[writable(episodes), searchQuery, sortFieldStore, sortDirectionStore], // Use writable(episodes) to react to changes
		([$episodes, $searchQuery, $sortField, $sortDirection]) => {
			let result = $episodes || [];

			if ($searchQuery) {
				const query = $searchQuery.toLowerCase();
				result = result.filter((ep) => ep.title?.toLowerCase().includes(query));
			}

			return [...result].sort((a, b) => {
				let aVal: any;
				let bVal: any;

				switch ($sortField) {
					case 'originallyAvailableAt':
						aVal = a.originallyAvailableAt || '';
						bVal = b.originallyAvailableAt || '';
						break;
					case 'index':
						aVal = a.index || 0;
						bVal = b.index || 0;
						break;
					case 'parentIndex': // Season number
						aVal = a.parentIndex || 0;
						bVal = b.parentIndex || 0;
						// Secondary sort by episode index if seasons are the same
						if (aVal === bVal) {
							aVal = a.index || 0;
							bVal = b.index || 0;
							return $sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
						}
						break;
					default: // Title
						aVal = a.title || '';
						bVal = b.title || '';
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

	// --- Lifecycle ---
	onMount(() => {
		fetchLibraries();
		fetchShowAndEpisodes();
		return () => {
			// Cleanup observers on component unmount
			observers.forEach((observer) => observer.disconnect());
			observers.clear();
			clearTimeout(searchTimeout);
		};
	});

	function handleSort(field: string) {
		if ($sortFieldStore === field) {
			sortDirectionStore.update((d) => (d === 'asc' ? 'desc' : 'asc'));
		} else {
			sortFieldStore.set(field);
			sortDirectionStore.set('asc'); // Default to asc for episodes maybe?
		}
	}
</script>

<svelte:head>
	<title>{show?.title || 'Show Details'} - Plexman</title>
</svelte:head>

<div class="min-h-screen bg-gray-100">
	<Header {libraries} />

	<main class="max-w-7xl mx-auto py-4 sm:px-4 lg:px-6">
		{#if loading}
			<div class="flex justify-center items-center h-64">
				<div
					class="w-12 h-12 border-t-4 border-orange-500 border-solid rounded-full animate-spin"
				></div>
			</div>
		{:else if error}
			<div
				class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative"
				role="alert"
			>
				<strong class="font-bold">Error!</strong>
				<span class="block sm:inline">{error}</span>
			</div>
		{:else if !show}
			<div class="text-center py-12">
				<p class="text-sm text-gray-500">Show not found or could not be loaded.</p>
			</div>
		{:else}
			<!-- Show Header -->
			<div class="mb-4 p-3 bg-white shadow rounded-lg">
				<div class="flex flex-col sm:flex-row sm:space-x-4">
					{#if show.thumb}
						<img
							src={`/api/plex-image${show.thumb}`}
							alt={show.title}
							class="w-32 h-48 sm:w-40 sm:h-60 object-cover rounded mx-auto sm:mx-0 mb-3 sm:mb-0 flex-shrink-0 bg-gray-200"
							loading="lazy"
						/>
					{:else}
						<div
							class="w-32 h-48 sm:w-40 sm:h-60 rounded bg-gray-200 flex items-center justify-center mx-auto sm:mx-0 mb-3 sm:mb-0 flex-shrink-0"
						>
							<svg class="w-16 h-16 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
								<path
									d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"
								/>
							</svg>
						</div>
					{/if}
					<div class="min-w-0 flex-grow text-center sm:text-left">
						<h1 class="text-xl sm:text-2xl font-bold text-gray-900 truncate">{show.title}</h1>
						{#if show.originalTitle && show.originalTitle !== show.title}
							<p class="text-sm text-gray-600 truncate">{show.originalTitle}</p>
						{/if}
						<div
							class="mt-1 flex flex-wrap items-center justify-center sm:justify-start text-xs text-gray-500 space-x-2"
						>
							{#if show.year}<span>{show.year}</span>{/if}
							{#if show.year && show.childCount}<span>•</span>{/if}
							{#if show.childCount}<span
									>{show.childCount} {show.childCount === 1 ? 'Season' : 'Seasons'}</span
								>{/if}
							{#if show.leafCount && (show.year || show.childCount)}<span>•</span>{/if}
							{#if show.leafCount}<span
									>{show.leafCount} {show.leafCount === 1 ? 'Episode' : 'Episodes'}</span
								>{/if}
						</div>
						{#if show.contentRating}<span
								class="inline-block mt-1 px-1.5 py-0.5 text-xs font-medium border border-gray-400 text-gray-600 rounded"
								>{show.contentRating}</span
							>{/if}
						{#if show.rating}<span class="inline-block mt-1 ml-2 text-xs text-yellow-600"
								>★ {show.rating.toFixed(1)}</span
							>{/if}
						{#if show.summary}
							<p class="mt-2 text-sm text-gray-600 line-clamp-4">{show.summary}</p>
						{/if}
					</div>
				</div>
			</div>

			<!-- Episode Filters -->
			<div class="mb-4 p-2 bg-white shadow rounded-lg flex items-center gap-2">
				<input
					type="search"
					placeholder="Search episodes..."
					bind:value={searchInput}
					on:input={(e) => debounceSearch(e.currentTarget.value)}
					class="flex-grow block w-full pl-3 pr-3 py-1 border border-gray-300 rounded-md text-sm focus:ring-orange-500 focus:border-orange-500"
				/>
				<!-- Add sort controls if needed -->
				<span class="text-sm text-gray-500">{$filteredAndSortedEpisodes.length} episodes</span>
			</div>

			<!-- Episodes Table -->
			<div class="bg-white shadow overflow-hidden sm:rounded-md">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-gray-50">
						<tr>
							<th
								scope="col"
								class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10"
								>S/E</th
							>
							<th
								scope="col"
								class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
								>Title</th
							>
							<th
								scope="col"
								class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20"
								>Air Date</th
							>
							<th
								scope="col"
								class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16"
								>Size</th
							>
							<th
								scope="col"
								class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28"
								>Video</th
							>
							<th
								scope="col"
								class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20"
								>Audio</th
							>
						</tr>
					</thead>
					<tbody class="bg-white divide-y divide-gray-200">
						{#each $filteredAndSortedEpisodes as episode (episode.ratingKey)}
							{@const detail = $detailedMedia.get(episode.ratingKey)}
							{@const media = detail?.Media?.[0] || episode.Media?.[0]}
							{@const part = media?.Part?.[0]}
							{@const video = part?.Stream?.find((s: Stream) => s.streamType === 1)}
							{@const audio = part?.Stream?.find((s: Stream) => s.streamType === 2)}
							<tr use:observeEpisode={episode} class="hover:bg-gray-50">
								<td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">
									{episode.parentIndex?.toString().padStart(2, '0')}x{episode.index
										?.toString()
										.padStart(2, '0')}
								</td>
								<td
									class="px-2 py-2 text-sm font-medium text-gray-900 truncate"
									title={episode.title}
								>
									{episode.title}
								</td>
								<td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500"
									>{episode.originallyAvailableAt || '--'}</td
								>
								<td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500"
									>{formatFileSize(part?.size)}</td
								>
								<td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">
									{#if video}{video.codec?.toUpperCase()} {video.height}p{:else}--{/if}
								</td>
								<td class="px-2 py-2 whitespace-nowrap text-sm text-gray-500">
									{#if audio}{audio.codec?.toUpperCase()} {audio.channels}ch{:else}--{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</main>
</div>
