<script lang="ts">
	import { goto } from '$app/navigation';
	export let libraries: any[] = [];

	function handleLogout() {
		localStorage.removeItem('plexToken');
		localStorage.removeItem('plexClientId');
		goto('/login');
	}
</script>

<nav class="bg-white shadow-sm">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
		<div class="flex justify-between h-16">
			<div class="flex items-center space-x-8">
				<a href="/" class="text-2xl font-bold text-gray-900 hover:text-orange-600 transition-colors"
					>Plexman</a
				>
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
