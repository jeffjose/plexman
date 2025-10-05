<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import Header from '../components/Header.svelte';
	import GlobalSearch from '../components/GlobalSearch.svelte';

	// Access server data
	$: ({ plexToken, plexServerUrl } = $page.data);

	// Types (assuming these might be shared or moved later)
	interface SessionMediaPartStream {
		streamType: number;
		codec?: string;
		bitrate?: number;
		profile?: string;
		level?: string;
		width?: number;
		height?: number;
		displayTitle?: string;
	}
	interface SessionMediaPart {
		size?: number;
		decision?: string;
		Stream?: SessionMediaPartStream[];
	}
	interface SessionMedia {
		bitrate?: number;
		Part?: SessionMediaPart[];
	}
	interface Session {
		title: string;
		thumb?: string;
		grandparentTitle?: string;
		parentIndex?: number;
		index?: number;
		type: string;
		User: { title: string };
		Player: { title: string; state: string };
		viewOffset: number;
		duration: number;
		Media?: SessionMedia[];
	}

	let libraries: any[] = [];
	let sessions: Session[] = [];
	let loadingLibraries = true;
	let loadingSessions = true;
	let error: string | null = null;

	// Combined loading state
	$: loading = loadingLibraries || loadingSessions;

	async function fetchSessions() {
		try {
			loadingSessions = true;
			if (!plexServerUrl || !plexToken) {
				throw new Error('Not authenticated');
			}
			const response = await fetch(
				`${plexServerUrl}/status/sessions?X-Plex-Token=${plexToken}`,
				{ headers: { Accept: 'application/json' } }
			);
			if (!response.ok) {
				let errorMsg = 'Failed to fetch sessions';
				try {
					const errorData = await response.json();
					errorMsg = errorData?.message || errorData?.error || errorMsg;
				} catch (_) {}
				if (response.status === 401) goto('/login');
				throw new Error(`${errorMsg} (Status: ${response.status})`);
			}
			const data = await response.json();
			sessions = data.MediaContainer.Metadata || [];
			error = null; // Clear previous errors on success
		} catch (e: any) {
			console.error('Failed to fetch sessions:', e);
			sessions = []; // Clear sessions on error
			error = e.message || 'An unknown error occurred while fetching sessions.';
			// No need to check for token error here, proxy/server handles 401
		} finally {
			loadingSessions = false;
		}
	}

	async function fetchLibraries() {
		try {
			loadingLibraries = true;
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
				if (response.status === 401) goto('/login');
				throw new Error(`${errorMsg} (Status: ${response.status})`);
			}

			const data = await response.json();
			libraries = data.MediaContainer.Directory || [];
			error = null; // Clear previous errors on success
		} catch (e: any) {
			console.error('Failed to fetch libraries:', e);
			libraries = []; // Clear libraries on error
			error = e.message || 'An unknown error occurred while fetching libraries.';
			// No need to check for token error here, proxy/server handles 401
		} finally {
			loadingLibraries = false;
		}
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
		return `${size.toFixed(size < 10 && unitIndex > 0 ? 2 : 0)} ${units[unitIndex]}`;
	}

	function formatBitrate(kbps: number): string {
		if (!kbps || kbps <= 0) return '0 Kbps';
		if (kbps >= 1000) {
			return `${(kbps / 1000).toFixed(1)} Mbps`;
		}
		return `${kbps} Kbps`;
	}

	onMount(() => {
		fetchLibraries();
		fetchSessions();
		// Set up polling for sessions every 10 seconds
		const interval = setInterval(fetchSessions, 10000);
		return () => clearInterval(interval);
	});
</script>

<div class="min-h-screen bg-gray-100">
	<!-- Pass libraries store/variable to Header -->
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
						<!-- Error Icon -->
						<svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
							<path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v4a1 1 0 102 0V5zm-1 9a1 1 0 100-2 1 1 0 000 2z"
								clip-rule="evenodd"
							/>
						</svg>
					</div>
					<div class="ml-3">
						<h3 class="text-sm font-medium text-red-800">Error Loading Data</h3>
						<div class="mt-2 text-sm text-red-700">{error}</div>
						<!-- Optional: Add a retry button -->
						<!-- <button on:click={() => { fetchLibraries(); fetchSessions(); }} class="mt-2 text-sm text-blue-600 hover:underline">Retry</button> -->
					</div>
				</div>
			</div>
		{:else if sessions.length > 0}
			<div class="mb-8">
				<h2 class="text-lg font-medium text-gray-900 mb-4">Current Sessions</h2>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each sessions as session (session.Player.title + session.User.title)}
						<div class="bg-white overflow-hidden shadow rounded-lg">
							<div class="p-4">
								<div class="flex space-x-3">
									{#if session.thumb && plexServerUrl && plexToken}
										<img
											src={`${plexServerUrl}${session.thumb}?X-Plex-Token=${plexToken}`}
											alt={session.title}
											class="w-16 h-24 object-cover rounded bg-gray-200"
											loading="lazy"
										/>
									{:else}
										<div class="w-16 h-24 rounded bg-gray-200 flex items-center justify-center">
											<svg class="w-8 h-8 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
												<path
													d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"
												/>
											</svg>
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<h3 class="text-sm font-medium text-gray-900 truncate" title={session.title}>
											{session.title}
										</h3>
										{#if session.type === 'episode'}
											<p
												class="text-xs text-gray-500 truncate"
												title={`${session.grandparentTitle} - S${session.parentIndex}E${session.index}`}
											>
												{session.grandparentTitle} - S{session.parentIndex}E{session.index}
											</p>
										{/if}
										<div class="mt-1 flex items-center text-xs text-gray-500 space-x-2 flex-wrap">
											<span class="font-medium text-orange-600">{session.User.title}</span>
											<span>•</span>
											<span class="truncate" title={session.Player.title}
												>{session.Player.title}</span
											>
											<span>•</span>
											<span>{session.Player.state}</span>
											{#if session.Player.state !== 'paused' && session.duration > 0}
												<span>•</span>
												<span>{Math.round((session.viewOffset / session.duration) * 100)}%</span>
											{/if}
										</div>
										{#if session.duration > 0}
											<div class="mt-1">
												<div class="bg-gray-200 rounded-full h-1 w-full overflow-hidden">
													<div
														class="h-1 rounded-full {session.Media?.[0]?.Part?.[0]?.decision ===
														'directplay'
															? 'bg-green-500'
															: 'bg-orange-500'}"
														style="width: {(session.viewOffset / session.duration) * 100}%"
													></div>
												</div>
											</div>
										{/if}
										{#if session.Media?.[0]}
											{@const media = session.Media[0]}
											{@const part = media.Part?.[0]}
											{@const videoStream = part?.Stream?.find((s) => s.streamType === 1)}
											{@const audioStream = part?.Stream?.find((s) => s.streamType === 2)}
											<div class="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500">
												{#if part?.decision === 'directplay' || part?.decision === 'copy'}
													<span
														class="inline-flex items-center space-x-1 bg-gray-100 px-1.5 py-0.5 rounded"
													>
														<span>{formatFileSize(part?.size || 0)}</span>
													</span>
													{#if videoStream}
														<span
															class="inline-flex items-center space-x-1 bg-gray-100 px-1.5 py-0.5 rounded"
														>
															<span class="uppercase">{videoStream.codec}</span>
															{#if videoStream.width && videoStream.height}
																<span>{videoStream.height}p</span>
															{/if}
														</span>
													{/if}
													<span
														class="inline-flex items-center space-x-1 bg-gray-100 px-1.5 py-0.5 rounded"
													>
														{#if media.bitrate}
															<span>{formatBitrate(media.bitrate)}</span>
														{/if}
														{#if videoStream?.bitrate && videoStream.bitrate !== media.bitrate}
															<span>({formatBitrate(videoStream.bitrate)} V)</span>
														{/if}
													</span>
												{:else if part?.decision === 'transcode'}
													{#if videoStream}
														<span
															class="inline-flex items-center space-x-1 bg-orange-100 px-1.5 py-0.5 rounded text-orange-700"
														>
															<span>{videoStream.displayTitle}</span>
															<svg
																xmlns="http://www.w3.org/2000/svg"
																class="h-3 w-3"
																viewBox="0 0 20 20"
																fill="currentColor"
																><path
																	fill-rule="evenodd"
																	d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
																	clip-rule="evenodd"
																/></svg
															>
															<span>{videoStream.codec?.toUpperCase()} {videoStream.height}p</span>
														</span>
													{/if}
													{#if audioStream}
														<span
															class="inline-flex items-center space-x-1 bg-orange-100 px-1.5 py-0.5 rounded text-orange-700"
														>
															<span>{audioStream.displayTitle}</span>
															<svg
																xmlns="http://www.w3.org/2000/svg"
																class="h-3 w-3"
																viewBox="0 0 20 20"
																fill="currentColor"
																><path
																	fill-rule="evenodd"
																	d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
																	clip-rule="evenodd"
																/></svg
															>
															<span>{audioStream.codec?.toUpperCase()}</span>
														</span>
													{/if}
												{/if}
											</div>
										{/if}
									</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{:else if !loadingLibraries}
			<!-- Only show "No sessions" if libraries *have* loaded (to avoid brief flash) -->
			<div class="text-center py-12">
				<svg
					class="mx-auto h-12 w-12 text-gray-400"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					aria-hidden="true"
				>
					<path
						vector-effect="non-scaling-stroke"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
					/>
				</svg>
				<h3 class="mt-4 text-xl font-medium text-gray-900">Search your libraries</h3>
				<p class="mt-2 text-sm text-gray-500">
					No active sessions. Use the search below to find your content.
				</p>
				<div class="mt-6 max-w-2xl mx-auto">
					{#if plexToken && plexServerUrl && libraries.length > 0}
						<GlobalSearch {plexToken} {plexServerUrl} {libraries} autofocus={true} />
					{/if}
				</div>
				<p class="mt-4 text-xs text-gray-400">Tip: Press "/" from anywhere to focus search</p>
			</div>
		{/if}

		{#if !loadingLibraries && libraries.length === 0 && !error}
			<div class="text-center py-12 mt-8">
				<svg
					class="mx-auto h-12 w-12 text-gray-400"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					aria-hidden="true"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
					/></svg
				>
				<h3 class="mt-2 text-sm font-medium text-gray-900">No libraries found</h3>
				<p class="mt-1 text-sm text-gray-500">Could not load libraries from your Plex server.</p>
			</div>
		{/if}
	</main>
</div>
