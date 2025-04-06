<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let error: string | null = null;

	async function checkPin() {
		const pinId = localStorage.getItem('plexPinId');
		const clientId = localStorage.getItem('plexClientId');

		if (!pinId || !clientId) {
			error = 'Missing authentication data';
			return;
		}

		try {
			const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
				headers: {
					Accept: 'application/json',
					'X-Plex-Client-Identifier': clientId
				}
			});

			if (!response.ok) {
				throw new Error('Failed to verify authentication');
			}

			const data = await response.json();

			if (data.authToken) {
				// Store the auth token
				localStorage.setItem('plexToken', data.authToken);
				// Clean up the temporary auth data
				localStorage.removeItem('plexPinId');
				// Redirect to home page
				goto('/');
			} else {
				throw new Error('No auth token received');
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Authentication failed';
		}
	}

	// Start checking for PIN verification immediately
	onMount(() => {
		checkPin();
	});
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-100">
	<div class="text-center">
		{#if error}
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
						<h3 class="text-sm font-medium text-red-800">Authentication Failed</h3>
						<div class="mt-2 text-sm text-red-700">{error}</div>
						<div class="mt-4">
							<a href="/login" class="text-sm text-orange-600 hover:text-orange-500"> Try Again </a>
						</div>
					</div>
				</div>
			</div>
		{:else}
			<h2 class="text-2xl font-semibold text-gray-700">Completing Authentication...</h2>
			<div class="mt-4">
				<div
					class="w-16 h-16 border-t-4 border-orange-500 border-solid rounded-full animate-spin mx-auto"
				></div>
			</div>
		{/if}
	</div>
</div>
