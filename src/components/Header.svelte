<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { Film, Tv, LogOut } from 'lucide-svelte';
	import GlobalSearch from './GlobalSearch.svelte';

	export let libraries: any[] = [];
	export let plexToken: string | null = null;
	export let plexServerUrl: string | null = null;
	export let hideSearch: boolean = false;
</script>

<nav class="bg-white shadow-sm">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
		<div class="flex justify-between h-16">
			<div class="flex items-center space-x-8">
				<a href="/" class="text-2xl font-bold text-gray-900 hover:text-orange-600 transition-colors"
					>Plexman</a
				>
				<div class="hidden sm:flex items-center space-x-4">
					{#each libraries as library}
						<a
							href="/library/{library.key}"
							class="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md hover:bg-gray-100 text-gray-700"
						>
							{#if library.type === 'movie'}
								<Film class="h-5 w-5 mr-2 text-orange-600" />
							{:else if library.type === 'show'}
								<Tv class="h-5 w-5 mr-2 text-orange-600" />
							{:else}
								<Film class="h-5 w-5 mr-2 text-orange-600" />
							{/if}
							{library.title}
						</a>
					{/each}
				</div>
			</div>
			<div class="flex items-center gap-4">
				{#if !hideSearch && plexToken && plexServerUrl && libraries.length > 0}
					<div class="hidden md:block w-64">
						<GlobalSearch {plexToken} {plexServerUrl} {libraries} />
					</div>
				{/if}
				<form action="/logout" method="POST" use:enhance>
					<button
						type="submit"
						class="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-orange-700 bg-orange-100 hover:bg-orange-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
					>
						<LogOut class="h-4 w-4 mr-2" />
						Logout
					</button>
				</form>
			</div>
		</div>
	</div>
</nav>
