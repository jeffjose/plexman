<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	let media: any[] = [];
	let loading = true;
	let error: string | null = null;
	let sortField = 'title';
	let sortDirection = 'asc';

	$: libraryId = $page.params.id;
	$: type = $page.url.searchParams.get('type');

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
				`${serverUrl}/library/sections/${libraryId}/all?type=${type === 'movie' ? 1 : 2}&includeFields=Media.Part.Stream`,
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
		} else {
			sortField = field;
			sortDirection = 'asc';
		}

		media = [...media].sort((a, b) => {
			const aVal = a[field] || '';
			const bVal = b[field] || '';
			return sortDirection === 'asc'
				? aVal.toString().localeCompare(bVal.toString())
				: bVal.toString().localeCompare(aVal.toString());
		});
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
		// Simply return the total bitrate from the API
		return `${bitrate} Kbps`;
	}

	function debugMovie(movie: any) {
		const mediaInfo = movie.Media?.[0] || {};
		const streams = mediaInfo.Part?.[0]?.Stream || [];

		console.log('Movie Debug Data:', {
			title: movie.title,
			totalBitrate: mediaInfo.bitrate,
			streams, // Log all streams without making assumptions about their types
			fullData: movie
		});
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
			<div class="bg-white shadow-sm rounded-lg overflow-hidden">
				<div class="overflow-x-auto">
					<table class="min-w-full divide-y divide-gray-200">
						<thead class="bg-gray-50">
							<tr>
								<th class="w-10 px-2 py-3"></th>
								<th
									class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48"
								>
									Poster
								</th>
								<th
									class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
									on:click={() => handleSort('title')}
								>
									Title
									{#if sortField === 'title'}
										<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
									{/if}
								</th>
								<th
									class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-20"
									on:click={() => handleSort('year')}
								>
									Year
									{#if sortField === 'year'}
										<span class="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
									{/if}
								</th>
								<th
									class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32"
								>
									Runtime
								</th>
								<th
									class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28"
								>
									Size
								</th>
								<th
									class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28"
								>
									Format
								</th>
								<th
									class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-28"
								>
									Bitrate
								</th>
							</tr>
						</thead>
						<tbody class="bg-white divide-y divide-gray-200">
							{#each media as item}
								<tr class="hover:bg-gray-50">
									<td class="px-2 py-4">
										<button
											on:click={() => debugMovie(item)}
											class="text-gray-400 hover:text-gray-600 transition-colors"
											title="Debug movie data"
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-5 w-5"
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
									<td class="px-6 py-4">
										{#if item.thumb}
											<img
												src={`${localStorage.getItem('plexServerUrl')}${item.thumb}?X-Plex-Token=${localStorage.getItem('plexToken')}`}
												alt={item.title}
												class="h-24 w-auto rounded shadow-sm"
											/>
										{/if}
									</td>
									<td class="px-6 py-4">
										<div>
											<div class="text-sm font-medium text-gray-900">{item.title}</div>
											{#if item.originalTitle && item.originalTitle !== item.title}
												<div class="text-sm text-gray-500">{item.originalTitle}</div>
											{/if}
										</div>
									</td>
									<td class="px-6 py-4 text-sm text-gray-500">
										{item.year || '-'}
									</td>
									<td class="px-6 py-4 text-sm text-gray-500 font-mono">
										{formatDuration(item.duration)}
									</td>
									<td class="px-6 py-4 text-sm text-gray-500">
										{#if item.Media?.[0]?.Part?.[0]?.size}
											{formatFileSize(item.Media[0].Part[0].size)}
										{:else}
											-
										{/if}
									</td>
									<td class="px-6 py-4">
										{#if item.Media?.[0]?.videoCodec}
											<span
												class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
											>
												{item.Media[0].videoCodec.toUpperCase()}
											</span>
										{:else}
											-
										{/if}
									</td>
									<td class="px-6 py-4 text-sm text-gray-500">
										{#if item.Media?.[0]?.bitrate}
											{formatBitrate(item.Media[0].bitrate)}
										{:else}
											-
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
