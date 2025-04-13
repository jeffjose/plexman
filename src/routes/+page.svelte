<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Header from '../components/Header.svelte';

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
			const resourcesUrl = new URL('https://plex.tv/api/v2/resources');
			resourcesUrl.searchParams.set('includeHttps', '1');
			const resourceResponse = await fetch(resourcesUrl.toString(), {
				headers
			});

			if (!resourceResponse.ok) {
				const errorData = await resourceResponse.json();
				throw new Error(errorData?.errors?.[0]?.message || 'Failed to fetch Plex servers');
			}

			const resources = await resourceResponse.json();
			const server = resources.find((r: any) => r.provides.includes('server'));

			if (!server) throw new Error('No Plex server found');

			// Intelligently select the server URL based on connection type and locality
			const connections = server.connections || [];
			let selectedUri: string | undefined = undefined;

			// Check if the app is running on HTTPS (indicator of being deployed)
			const isHttps = window.location.protocol === 'https:';

			if (isHttps) {
				// Running deployed (HTTPS): Prioritize remote HTTPS (prefer .plex.direct)
				const remoteHttps = connections.filter((c: any) => c.protocol === 'https' && !c.local);
				selectedUri = remoteHttps.find((c: any) => c.uri.includes('.plex.direct'))?.uri;
				if (!selectedUri) {
					selectedUri = remoteHttps[0]?.uri; // Fallback to first remote HTTPS
				}
			} else {
				// Running locally (HTTP/other): Prioritize constructing URL from local connection details
				const localConnection = connections.find((c: any) => c.local);
				if (localConnection) {
					// Construct URL using http, address, and port for local access
					selectedUri = `http://${localConnection.address}:${localConnection.port}`;
				} else {
					// Fallback: If no local connection found, use best remote (HTTPS preferred)
					console.warn('fetchLibraries: No local connection found, falling back to remote.');
					const remoteHttps = connections.filter((c: any) => c.protocol === 'https' && !c.local);
					selectedUri =
						remoteHttps.find((c: any) => c.uri.includes('.plex.direct'))?.uri ||
						remoteHttps[0]?.uri;

					if (!selectedUri) {
						// Last resort fallback: remote HTTP
						const remoteHttp = connections.filter((c: any) => c.protocol === 'http' && !c.local);
						selectedUri = remoteHttp[0]?.uri;
					}
				}
			}

			// Ultimate fallback: Use the first connection URI if nothing else matched
			if (!selectedUri && connections.length > 0) {
				console.warn(
					'fetchLibraries: Could not find ideal connection using protocol/locality, using first available URI as fallback.'
				);
				selectedUri = connections[0].uri;
			}

			const serverUrl = selectedUri;

			if (!serverUrl) {
				throw new Error(
					'No suitable connection URI found for the Plex server based on context (HTTPS/Local)'
				);
			}
			localStorage.setItem('plexServerUrl', serverUrl);
			console.log(`fetchLibraries: Stored serverUrl: ${serverUrl} (isHttps: ${isHttps})`);

			// Then fetch the libraries from the selected server URL
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
