<script lang="ts">
	interface Show {
		id: string;
		showTitle: string;
		count: number;
		newestAirDate: string;
	}

	interface Props {
		shows: Show[];
	}

	let { shows }: Props = $props();
</script>

<!-- A count per show, ahead of the episode list. Twelve rows of "House of the
     Dragon" answer "what's missing"; this answers "what should I go and get",
     which is the question you actually opened the page with. -->
<ul class="flex flex-wrap gap-x-2 gap-y-1.5">
	{#each shows as show (show.id)}
		<li
			class="flex items-baseline gap-1.5 rounded-full border px-2.5 py-1 text-xs"
			title="Newest gap aired {show.newestAirDate}"
		>
			<span class="max-w-52 truncate">{show.showTitle}</span>
			<span class="tabular font-medium">{show.count}</span>
		</li>
	{/each}
</ul>
