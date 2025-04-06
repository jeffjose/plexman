<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let libraries: any[] = [];
	let loading = true;
	let error: string | null = null;

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

			// Then fetch the libraries from the first server
			const libraryResponse = await fetch(`${server.connections[0].uri}/library/sections`, {
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

	onMount(fetchLibraries);
</script>

<div class="min-h-screen bg-gray-100">
	<nav class="bg-white shadow-sm">
		<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
			<div class="flex justify-between h-16">
				<div class="flex items-center">
					<h1 class="text-2xl font-bold text-gray-900">Plexman</h1>
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
		{:else}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each libraries as library}
					<div class="bg-white overflow-hidden shadow rounded-lg">
						<div class="px-4 py-5 sm:p-6">
							<div class="flex items-center">
								<div class="flex-shrink-0 bg-orange-100 rounded-md p-3">
									<svg
										class="h-6 w-6 text-orange-600"
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
								</div>
								<div class="ml-5">
									<h3 class="text-lg font-medium text-gray-900">
										{library.title}
									</h3>
									<div class="mt-1 text-sm text-gray-500">
										{library.type.charAt(0).toUpperCase() + library.type.slice(1)}
									</div>
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</main>
</div>
