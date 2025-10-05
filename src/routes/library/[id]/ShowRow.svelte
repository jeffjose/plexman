<script lang="ts">
	import { page } from '$app/stores';

	export let show: any;
	export let libraryId: string;

	// Access server data
	$: ({ plexToken, plexServerUrl } = $page.data);
	$: posterUrl =
		show.thumb && plexServerUrl && plexToken
			? `${plexServerUrl}${show.thumb}?X-Plex-Token=${plexToken}`
			: '';
</script>

<a
	href="/library/{libraryId}/show/{show.ratingKey}"
	class="block bg-white rounded overflow-hidden hover:ring-1 hover:ring-orange-500 transition-shadow duration-200"
>
	<div class="aspect-[2/3] relative">
		<img
			src={posterUrl}
			alt={show.title}
			class="absolute inset-0 w-full h-full object-cover"
			loading="lazy"
		/>
	</div>
	<div class="p-1">
		<h3 class="text-xs font-medium text-gray-900 truncate" title={show.title}>{show.title}</h3>
		{#if show.originalTitle && show.originalTitle !== show.title}
			<p class="text-xs text-gray-500 truncate" title={show.originalTitle}>{show.originalTitle}</p>
		{/if}
		<div class="flex items-center text-xs text-gray-500 space-x-1">
			<span>{show.year}</span>
			<span>•</span>
			<span>{show.childCount}{show.childCount === 1 ? 'S' : 'S'}</span>
			{#if show.leafCount}
				<span>•</span>
				<span>{show.leafCount}{show.leafCount === 1 ? 'E' : 'E'}</span>
			{/if}
		</div>
	</div>
</a>
