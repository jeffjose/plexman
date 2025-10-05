<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Search } from 'lucide-svelte';

	interface Library {
		key: string;
		title: string;
		type: string;
	}

	interface PlexItem {
		ratingKey: string;
		title: string;
		type: string;
		year?: number;
		parentTitle?: string;
		grandparentTitle?: string;
		index?: number;
		parentIndex?: number;
		librarySectionKey?: string;
	}

	let {
		plexToken,
		plexServerUrl,
		libraries,
		autofocus = false
	}: {
		plexToken: string;
		plexServerUrl: string;
		libraries: Library[];
		autofocus?: boolean;
	} = $props();

	let searchQuery = $state('');
	let searchResults = $state<PlexItem[]>([]);
	let isSearching = $state(false);
	let showResults = $state(false);
	let searchInput: HTMLInputElement;
	let selectedIndex = $state(0);

	async function performSearch(query: string) {
		if (!query.trim()) {
			searchResults = [];
			showResults = false;
			return;
		}

		isSearching = true;
		showResults = true;
		const allResults: PlexItem[] = [];

		try {
			// Search across all libraries
			for (const library of libraries) {
				const response = await fetch(
					`${plexServerUrl}/library/sections/${library.key}/all?X-Plex-Token=${plexToken}&title=${encodeURIComponent(query)}`,
					{ headers: { Accept: 'application/json' } }
				);

				if (response.ok) {
					const data = await response.json();
					const items = (data.MediaContainer.Metadata || []).map((item: any) => ({
						...item,
						librarySectionKey: library.key
					}));
					allResults.push(...items);
				}
			}

			searchResults = allResults.slice(0, 20); // Limit to top 20 results
		} catch (e) {
			console.error('Search failed:', e);
		} finally {
			isSearching = false;
		}
	}

	function handleInput() {
		selectedIndex = 0; // Select first item by default
		// Debounce search
		performSearch(searchQuery);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!showResults || searchResults.length === 0) return;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, searchResults.length - 1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			// Use first item if nothing selected, otherwise use selected item
			const itemToNavigate = selectedIndex >= 0 ? searchResults[selectedIndex] : searchResults[0];
			if (itemToNavigate) {
				navigateToResult(itemToNavigate);
			}
		} else if (event.key === 'Escape') {
			event.preventDefault();
			closeSearch();
		}
	}

	function navigateToResult(item: PlexItem) {
		if (item.type === 'movie') {
			goto(`/library/${item.librarySectionKey}`);
		} else if (item.type === 'show') {
			goto(`/library/${item.librarySectionKey}/show/${item.ratingKey}`);
		} else if (item.type === 'episode') {
			goto(`/library/${item.librarySectionKey}`);
		}
		closeSearch();
	}

	function closeSearch() {
		showResults = false;
		searchQuery = '';
		searchResults = [];
		selectedIndex = 0;
	}

	function formatResultTitle(item: PlexItem): string {
		if (item.type === 'episode') {
			return `${item.grandparentTitle} - S${item.parentIndex}E${item.index} - ${item.title}`;
		} else if (item.type === 'season') {
			return `${item.parentTitle} - Season ${item.index}`;
		}
		return item.title;
	}

	onMount(() => {
		// Global keyboard handler for "/" key
		function handleGlobalKeydown(event: KeyboardEvent) {
			// Only activate if "/" is pressed and we're not in an input/textarea
			if (
				event.key === '/' &&
				document.activeElement?.tagName !== 'INPUT' &&
				document.activeElement?.tagName !== 'TEXTAREA'
			) {
				event.preventDefault();
				searchInput?.focus();
			}
		}

		window.addEventListener('keydown', handleGlobalKeydown);

		// Auto-focus if requested
		if (autofocus) {
			setTimeout(() => searchInput?.focus(), 100);
		}

		return () => {
			window.removeEventListener('keydown', handleGlobalKeydown);
		};
	});

	// Click outside to close
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.search-container')) {
			showResults = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="search-container relative w-full">
	<div class="relative">
		<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
			<Search class="h-5 w-5 text-gray-400" />
		</div>
		<input
			bind:this={searchInput}
			bind:value={searchQuery}
			oninput={handleInput}
			onkeydown={handleKeydown}
			type="text"
			placeholder="Search your libraries... (press / to focus)"
			class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 sm:text-sm"
		/>
		{#if isSearching}
			<div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
				<div
					class="w-4 h-4 border-t-2 border-orange-500 border-solid rounded-full animate-spin"
				></div>
			</div>
		{/if}
	</div>

	{#if showResults && searchResults.length > 0}
		<div
			class="absolute z-50 mt-1 w-full bg-white shadow-lg max-h-96 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm"
		>
			{#each searchResults as result, idx (result.ratingKey)}
				<button
					type="button"
					onclick={() => navigateToResult(result)}
					class="w-full text-left cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-gray-100 {selectedIndex ===
					idx
						? 'bg-orange-50'
						: ''}"
				>
					<div class="flex items-center">
						<span class="font-normal block truncate">
							{formatResultTitle(result)}
							{#if result.year}
								<span class="text-gray-500">({result.year})</span>
							{/if}
						</span>
					</div>
					<span class="text-orange-600 absolute inset-y-0 right-0 flex items-center pr-4">
						<span class="text-xs uppercase">{result.type}</span>
					</span>
				</button>
			{/each}
		</div>
	{:else if showResults && searchQuery.trim() && !isSearching}
		<div
			class="absolute z-50 mt-1 w-full bg-white shadow-lg rounded-md py-2 px-3 text-sm text-gray-500"
		>
			No results found
		</div>
	{/if}
</div>
