<script lang="ts">
	const PLEX_AUTH_URL = 'https://app.plex.tv/auth';
	let loading = false;
	let error: string | null = null;

	async function handlePlexLogin() {
		try {
			loading = true;
			error = null;

			// Generate a random identifier for this client
			const identifier = Math.random().toString(36).substring(2, 15);
			localStorage.setItem('plexClientId', identifier);

			// First get a PIN from Plex
			const pinResponse = await fetch('https://plex.tv/api/v2/pins', {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'X-Plex-Product': 'Plexman',
					'X-Plex-Client-Identifier': identifier
				},
				body: new URLSearchParams({
					strong: 'true'
				})
			});

			if (!pinResponse.ok) {
				throw new Error('Failed to get PIN from Plex');
			}

			const pinData = await pinResponse.json();
			localStorage.setItem('plexPinId', pinData.id.toString());

			// Construct auth URL with the PIN code
			const params = new URLSearchParams({
				clientID: identifier,
				code: pinData.code,
				'context[device][product]': 'Plexman',
				'context[device][version]': '1.0.0',
				'context[device][platform]': 'Web',
				'context[device][platformVersion]': '1.0.0',
				'context[device][device]': 'Browser',
				'context[device][deviceName]': 'Plexman Web',
				'context[device][model]': 'browser',
				'context[device][vendor]': 'browser',
				forwardUrl: `${window.location.origin}/auth/callback`
			});

			// Redirect to Plex auth page
			window.location.href = `${PLEX_AUTH_URL}#?${params.toString()}`;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to initialize Plex login';
			loading = false;
		}
	}
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-100">
	<div class="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-lg">
		<div class="text-center">
			<h2 class="mt-6 text-3xl font-extrabold text-gray-900">Welcome to Plexman</h2>
			<p class="mt-2 text-sm text-gray-600">Manage your Plex library with ease</p>
		</div>
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
						<h3 class="text-sm font-medium text-red-800">Error</h3>
						<div class="mt-2 text-sm text-red-700">{error}</div>
					</div>
				</div>
			</div>
		{/if}
		<div class="mt-8">
			<button
				on:click={handlePlexLogin}
				disabled={loading}
				class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
			>
				{#if loading}
					<div
						class="w-5 h-5 border-t-2 border-white border-solid rounded-full animate-spin mr-2"
					></div>
				{/if}
				Sign in with Plex
			</button>
		</div>
	</div>
</div>
