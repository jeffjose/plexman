<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { writable, derived } from 'svelte/store';
	import MovieRow from '../../MovieRow.svelte';

	let show: any = null;
	let episodes: any[] = [];
	let loading = true;
	let error: string | null = null;
	let sortField = 'originallyAvailableAt';
	let sortDirection = 'asc';
	let observers = new Map();

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
	$: showId = $page.params.showId;

	const filteredEpisodes = derived(
		[searchQuery, sortFieldStore, sortDirectionStore],
		([$searchQuery, $sortField, $sortDirection]) => {
			// First filter the episodes
			let result = !$searchQuery
				? episodes
				: episodes.filter(
						(item) =>
							item.title.toLowerCase().includes($searchQuery.toLowerCase()) ||
							`S${item.parentIndex}E${item.index}`
								.toLowerCase()
								.includes($searchQuery.toLowerCase())
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
					case 'originallyAvailableAt':
						aVal = a.originallyAvailableAt || '';
						bVal = b.originallyAvailableAt || '';
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

	let detailedMedia = new Map<string, any>();

	function createObserver(episode: any) {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						debugEpisode(episode);
						observer.disconnect();
						observers.delete(episode.ratingKey);
					}
				});
			},
			{ threshold: 0.1 }
		);
		return observer;
	}

	function observeEpisode(element: HTMLElement, episode: any) {
		if (!observers.has(episode.ratingKey)) {
			const observer = createObserver(episode);
			observers.set(episode.ratingKey, observer);
			observer.observe(element);
		}
	}

	async function fetchShow() {
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
			// First get the show details
			const showResponse = await fetch(
				`${serverUrl}/library/metadata/${showId}?includeChildren=1`,
				{ headers }
			);

			if (!showResponse.ok) {
				const errorData = await showResponse.json();
				throw new Error(errorData?.errors?.[0]?.message || 'Failed to fetch show');
			}

			const showData = await showResponse.json();
			show = showData.MediaContainer.Metadata[0];

			// Then get all episodes
			const episodesResponse = await fetch(
				`${serverUrl}/library/metadata/${showId}/allLeaves?` +
					new URLSearchParams({
						includeExternalMedia: '1',
						includePreferences: '1',
						checkFiles: '1',
						asyncCheckFiles: '0'
					}),
				{ headers }
			);

			if (!episodesResponse.ok) {
				const errorData = await episodesResponse.json();
				throw new Error(errorData?.errors?.[0]?.message || 'Failed to fetch episodes');
			}

			const episodesData = await episodesResponse.json();
			episodes = episodesData.MediaContainer.Metadata || [];
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
		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
			.toString()
			.padStart(2, '0')}`;
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

	$: allSizes = episodes
		.flatMap((item) => item.Media?.map((m: any) => m?.Part?.[0]?.size || 0) || [])
		.filter((size) => size > 0);
	$: allOverallBitrates = episodes
		.flatMap((item) => item.Media?.map((m: any) => m?.bitrate || 0) || [])
		.filter((br) => br > 0);

	function getPercentiles(size: number, overallBitrate: number) {
		return {
			sizePercentile: calculatePercentile(size, allSizes),
			overallBitratePercentile: calculatePercentile(overallBitrate, allOverallBitrates)
		};
	}

	async function debugEpisode(episode: any) {
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
			'X-Plex-Device-Name': 'Plexman Web'
		};

		try {
			const response = await fetch(
				`${serverUrl}/library/metadata/${episode.ratingKey}?` +
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
			detailedMedia.set(episode.ratingKey, item);
			detailedMedia = detailedMedia; // Trigger reactivity
		} catch (e) {
			console.error('Failed to fetch detailed metadata:', e);
		}
	}

	onMount(() => {
		fetchShow();
		return () => {
			// Cleanup observers on component unmount
			observers.forEach((observer) => observer.disconnect());
			observers.clear();
		};
	});
</script>

<div class="min-h-screen bg-gray-100">
	<nav class="bg-white shadow-sm">
		<div class="max-w-7xl mx-auto px-4">
			<div class="flex justify-between h-12">
				<div class="flex items-center space-x-4">
					<a href="/" class="text-lg font-bold text-gray-900">Plexman</a>
					<a href="/library/{libraryId}?type=show" class="text-gray-500 hover:text-gray-700">
						← Back to Shows
					</a>
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
						<h3 class="text-sm font-medium text-red-800">Error loading show</h3>
						<div class="mt-2 text-sm text-red-700">{error}</div>
					</div>
				</div>
			</div>
		{:else}
			<div class="mb-2">
				<div class="flex space-x-3">
					<img
						src={`${localStorage.getItem('plexServerUrl')}${show.thumb}?X-Plex-Token=${localStorage.getItem('plexToken')}`}
						alt={show.title}
						class="w-24 h-36 object-cover rounded"
					/>
					<div class="min-w-0">
						<h1 class="text-lg font-medium text-gray-900 truncate">{show.title}</h1>
						{#if show.originalTitle && show.originalTitle !== show.title}
							<p class="text-sm text-gray-600 truncate">{show.originalTitle}</p>
						{/if}
						<div class="mt-1 flex items-center text-xs text-gray-500 space-x-2">
							<span>{show.year}</span>
							<span>•</span>
							<span>{show.childCount} {show.childCount === 1 ? 'Season' : 'Seasons'}</span>
							{#if show.leafCount}
								<span>•</span>
								<span>{show.leafCount} {show.leafCount === 1 ? 'Episode' : 'Episodes'}</span>
							{/if}
						</div>
						{#if show.summary}
							<p class="mt-1 text-xs text-gray-600 line-clamp-2">{show.summary}</p>
						{/if}
					</div>
				</div>
			</div>

			<div class="mb-4">
				<div class="relative">
					<input
						type="text"
						bind:value={searchInput}
						on:input={() => debounceSearch(searchInput)}
						placeholder="Search episodes..."
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
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16"
								>
									Episode
								</th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
								>
									Title
								</th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20"
								>
									Runtime
								</th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16"
								>
									Codec
								</th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20"
								>
									<button
										type="button"
										class="w-full text-left hover:bg-gray-100"
										on:click={() => handleSort('overallBitrate')}
										on:keydown={(e) => e.key === 'Enter' && handleSort('overallBitrate')}
									>
										Overall
										{#if sortField === 'overallBitrate'}
											<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
										{/if}
									</button>
								</th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20"
								>
									<button
										type="button"
										class="w-full text-left hover:bg-gray-100"
										on:click={() => handleSort('videoBitrate')}
										on:keydown={(e) => e.key === 'Enter' && handleSort('videoBitrate')}
									>
										Video
										{#if sortField === 'videoBitrate'}
											<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
										{/if}
									</button>
								</th>
								<th
									class="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20"
								>
									Audio
								</th>
							</tr>
						</thead>
						<tbody class="bg-white divide-y divide-gray-100">
							{#each $filteredEpisodes as episode (episode.ratingKey)}
								<tr class="hover:bg-gray-50" use:observeEpisode={episode}>
									<td class="px-2 py-1 text-xs text-gray-500 whitespace-nowrap">
										S{episode.parentIndex.toString().padStart(2, '0')}E{episode.index
											.toString()
											.padStart(2, '0')}
									</td>
									<td class="px-2 py-1 text-xs">
										<div class="flex items-center">
											<span class="font-medium text-gray-900">{episode.title}</span>
										</div>
									</td>
									<td class="px-2 py-1 text-xs text-gray-500 whitespace-nowrap">
										{formatDuration(episode.duration)}
									</td>
									<td class="px-2 py-1 text-xs text-gray-500 whitespace-nowrap">
										{#if episode.Media?.[0]}
											{@const media = episode.Media[0]}
											{media.videoCodec === 'hevc'
												? 'HEVC'
												: media.videoCodec?.toUpperCase() || '—'}
										{:else}
											—
										{/if}
									</td>
									<td class="px-2 py-1 text-xs text-gray-500 whitespace-nowrap">
										{#if episode.Media?.[0]?.bitrate}
											{episode.Media[0].bitrate} Kbps
										{:else}
											—
										{/if}
									</td>
									<td class="px-2 py-1 text-xs text-gray-500 whitespace-nowrap">
										{#if episode.Media?.[0]?.Part?.[0]?.Stream}
											{@const videoStream = episode.Media[0].Part[0].Stream.find(
												(s: any) => s.streamType === 1
											)}
											{videoStream?.bitrate ? `${videoStream.bitrate} Kbps` : '—'}
										{:else}
											{@const detailedEpisode = detailedMedia.get(episode.ratingKey)}
											{#if detailedEpisode?.Media?.[0]?.Part?.[0]?.Stream}
												{@const videoStream = detailedEpisode.Media[0].Part[0].Stream.find(
													(s: any) => s.streamType === 1
												)}
												{videoStream?.bitrate ? `${videoStream.bitrate} Kbps` : '—'}
											{:else}
												—
											{/if}
										{/if}
									</td>
									<td class="px-2 py-1 text-xs text-gray-500 whitespace-nowrap">
										{#if episode.Media?.[0]?.Part?.[0]?.Stream}
											{@const audioStream = episode.Media[0].Part[0].Stream.find(
												(s: any) => s.streamType === 2
											)}
											{audioStream?.bitrate ? `${audioStream.bitrate} Kbps` : '—'}
										{:else}
											{@const detailedEpisode = detailedMedia.get(episode.ratingKey)}
											{#if detailedEpisode?.Media?.[0]?.Part?.[0]?.Stream}
												{@const audioStream = detailedEpisode.Media[0].Part[0].Stream.find(
													(s: any) => s.streamType === 2
												)}
												{audioStream?.bitrate ? `${audioStream.bitrate} Kbps` : '—'}
											{:else}
												—
											{/if}
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</main>
</div>
