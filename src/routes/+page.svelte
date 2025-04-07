<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let libraries: any[] = [];
	let sessions: any[] = [];
	let loading = true;
	let error: string | null = null;

	async function fetchSessions() {
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
			const response = await fetch(`${serverUrl}/status/sessions`, { headers });
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData?.errors?.[0]?.message || 'Failed to fetch sessions');
			}
			const data = await response.json();
			sessions = data.MediaContainer.Metadata || [];

			// Debug logging
			sessions.forEach((session, index) => {
				console.log(`\nSession ${index + 1}: ${session.title}`);
				if (session.Media?.[0]) {
					const media = session.Media[0];
					const videoStream = media.Part?.[0]?.Stream?.find((s: any) => s.streamType === 1);
					const audioStream = media.Part?.[0]?.Stream?.find((s: any) => s.streamType === 2);
					console.log('Media:', {
						size: media.Part?.[0]?.size,
						videoCodec: videoStream?.codec,
						fileBitrate: media.bitrate,
						videoBitrate: videoStream?.bitrate,
						audioBitrate: audioStream?.bitrate,
						videoProfile: videoStream?.profile,
						videoLevel: videoStream?.level,
						resolution: `${videoStream?.width}x${videoStream?.height}`,
						fullVideoStream: videoStream,
						fullAudioStream: audioStream,
						fullMediaPart: media.Part?.[0]
					});
				} else {
					console.log('No media information available');
				}
			});
		} catch (e) {
			console.error('Failed to fetch sessions:', e);
		}
	}

	async function fetchLibraries() {
		const token = localStorage.getItem('plexToken');
		const clientId = localStorage.getItem('plexClientId');

		if (!token || !clientId) {
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
			// First, get the user's servers
			const resourceResponse = await fetch('https://plex.tv/api/v2/resources', {
				headers
			});

			if (!resourceResponse.ok) {
				const errorData = await resourceResponse.json();
				throw new Error(errorData?.errors?.[0]?.message || 'Failed to fetch Plex servers');
			}

			const resources = await resourceResponse.json();
			const server = resources.find((r: any) => r.provides.includes('server'));

			if (!server) throw new Error('No Plex server found');

			// Store the server URL for later use
			const serverUrl = server.connections[0].uri;
			localStorage.setItem('plexServerUrl', serverUrl);

			// Then fetch the libraries from the first server
			const libraryResponse = await fetch(`${serverUrl}/library/sections`, {
				headers
			});

			if (!libraryResponse.ok) {
				const errorData = await libraryResponse.json();
				throw new Error(errorData?.errors?.[0]?.message || 'Failed to fetch libraries');
			}

			const data = await libraryResponse.json();
			libraries = data.MediaContainer.Directory;
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

	function handleLogout() {
		localStorage.removeItem('plexToken');
		localStorage.removeItem('plexClientId');
		goto('/login');
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
		return `${bitrate} Kbps`;
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
	<nav class="bg-white shadow-sm">
		<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
			<div class="flex justify-between h-16">
				<div class="flex items-center space-x-8">
					<h1 class="text-2xl font-bold text-gray-900">Plexman</h1>
					<div class="flex items-center space-x-4">
						{#each libraries as library}
							<a
								href="/library/{library.key}?type={library.type}"
								class="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md hover:bg-gray-100 text-gray-700"
							>
								<svg
									class="h-5 w-5 mr-2 text-orange-600"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									{#if library.type === 'movie'}
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
										/>
									{:else if library.type === 'show'}
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
										/>
									{:else}
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
										/>
									{/if}
								</svg>
								{library.title}
							</a>
						{/each}
					</div>
				</div>
				<div class="flex items-center">
					<button
						on:click={handleLogout}
						class="ml-4 px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
					>
						Logout
					</button>
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
						<h3 class="text-sm font-medium text-red-800">Error loading libraries</h3>
						<div class="mt-2 text-sm text-red-700">{error}</div>
					</div>
				</div>
			</div>
		{:else if sessions.length > 0}
			<div class="mb-8">
				<h2 class="text-lg font-medium text-gray-900 mb-4">Current Sessions</h2>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each sessions as session}
						<div class="bg-white overflow-hidden shadow rounded-lg">
							<div class="p-4">
								<div class="flex space-x-3">
									<img
										src={`${localStorage.getItem('plexServerUrl')}${session.thumb}?X-Plex-Token=${localStorage.getItem('plexToken')}`}
										alt={session.title}
										class="w-16 h-24 object-cover rounded"
									/>
									<div class="min-w-0">
										<h3 class="text-sm font-medium text-gray-900 truncate">
											{session.title}
										</h3>
										{#if session.type === 'episode'}
											<p class="text-xs text-gray-500">
												{session.grandparentTitle} - S{session.parentIndex}E{session.index}
											</p>
										{/if}
										<div class="mt-1 flex items-center text-xs text-gray-500 space-x-2">
											<span class="font-medium text-orange-600">{session.User.title}</span>
											<span>•</span>
											<span>{session.Player.title}</span>
											<span>•</span>
											<span>{session.Player.state}</span>
											{#if session.Player.state !== 'paused'}
												<span>•</span>
												<span>{Math.round((session.viewOffset / session.duration) * 100)}%</span>
											{/if}
										</div>
										<div class="mt-1">
											<div class="bg-gray-200 rounded-full h-1">
												<div
													class="h-1 rounded-full {session.Media?.[0]?.Part?.[0]?.decision ===
													'directplay'
														? 'bg-green-500'
														: 'bg-orange-500'}"
													style="width: {(session.viewOffset / session.duration) * 100}%"
												></div>
											</div>
										</div>
										{#if session.Media?.[0]}
											{@const media = session.Media[0]}
											{@const videoStream = media.Part?.[0]?.Stream?.find(
												(s: any) => s.streamType === 1
											)}
											{@const audioStream = media.Part?.[0]?.Stream?.find(
												(s: any) => s.streamType === 2
											)}
											<div class="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
												{#if media.Part?.[0]?.decision === 'directplay'}
													<span
														class="inline-flex items-center space-x-1 bg-gray-100 px-2 py-1 rounded"
													>
														<span>{formatFileSize(media.Part?.[0]?.size || 0)}</span>
													</span>
													<span
														class="inline-flex items-center space-x-1 bg-gray-100 px-2 py-1 rounded"
													>
														<span class="uppercase">{videoStream?.codec || '—'}</span>
													</span>
													<span
														class="inline-flex items-center space-x-1 bg-gray-100 px-2 py-1 rounded"
													>
														<span
															>{formatBitrate(media.bitrate || 0)} / {formatBitrate(
																videoStream?.bitrate || 0
															)}</span
														>
													</span>
												{:else}
													{#if videoStream}
														<span
															class="inline-flex items-center space-x-1 bg-gray-100 px-2 py-1 rounded"
														>
															<span
																>{videoStream.displayTitle} → {videoStream.codec.toUpperCase()}
																{videoStream.width}x{videoStream.height}</span
															>
														</span>
													{/if}
													{#if audioStream}
														<span
															class="inline-flex items-center space-x-1 bg-gray-100 px-2 py-1 rounded"
														>
															<span
																>Audio: {audioStream.displayTitle} → {audioStream.channels}ch {formatBitrate(
																	audioStream.bitrate || 0
																)}</span
															>
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
		{/if}
	</main>
</div>
