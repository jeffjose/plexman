<script lang="ts" generics="T">
	import { onMount, tick } from 'svelte';

	interface Props {
		items: T[];
		itemHeight: number;
		overscan?: number;
		children: any;
	}

	let { items, itemHeight, overscan = 5, children }: Props = $props();

	let scrollContainer: HTMLDivElement;
	let scrollTop = $state(0);
	let containerHeight = $state(0);

	// Calculate visible range
	const startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - overscan));
	const endIndex = $derived(
		Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan)
	);
	const visibleItems = $derived(items.slice(startIndex, endIndex));

	const totalHeight = $derived(items.length * itemHeight);
	const offsetY = $derived(startIndex * itemHeight);

	function handleScroll() {
		if (scrollContainer) {
			scrollTop = scrollContainer.scrollTop;
		}
	}

	function updateContainerHeight() {
		if (scrollContainer) {
			containerHeight = scrollContainer.clientHeight;
		}
	}

	onMount(() => {
		updateContainerHeight();
		const resizeObserver = new ResizeObserver(updateContainerHeight);
		if (scrollContainer) {
			resizeObserver.observe(scrollContainer);
		}

		return () => {
			resizeObserver.disconnect();
		};
	});
</script>

<div
	bind:this={scrollContainer}
	on:scroll={handleScroll}
	class="overflow-auto"
	style="height: 100%; width: 100%;"
>
	<div style="height: {totalHeight}px; position: relative;">
		<div style="position: absolute; top: {offsetY}px; width: 100%;">
			{#each visibleItems as item, i (items.indexOf(item))}
				{@render children(item, startIndex + i)}
			{/each}
		</div>
	</div>
</div>
