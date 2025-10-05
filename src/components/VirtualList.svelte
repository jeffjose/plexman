<script lang="ts" generics="T">
	import { onMount, onDestroy } from 'svelte';

	interface Props {
		items: T[];
		itemHeight: number;
		overscan?: number;
		children: any;
	}

	let { items, itemHeight, overscan = 5, children }: Props = $props();

	let containerEl: HTMLDivElement;
	let scrollTop = $state(0);
	let containerTop = $state(0);
	let viewportHeight = $state(0);

	// Calculate visible range based on window scroll
	const startIndex = $derived(
		Math.max(0, Math.floor((scrollTop - containerTop) / itemHeight) - overscan)
	);
	const endIndex = $derived(
		Math.min(
			items.length,
			Math.ceil((scrollTop + viewportHeight - containerTop) / itemHeight) + overscan
		)
	);
	const visibleItems = $derived(items.slice(startIndex, endIndex));

	const totalHeight = $derived(items.length * itemHeight);
	const offsetY = $derived(startIndex * itemHeight);

	function handleScroll() {
		scrollTop = window.scrollY;
	}

	function updateMeasurements() {
		viewportHeight = window.innerHeight;
		if (containerEl) {
			containerTop = containerEl.offsetTop;
		}
	}

	onMount(() => {
		updateMeasurements();
		window.addEventListener('scroll', handleScroll, { passive: true });
		window.addEventListener('resize', updateMeasurements);

		// Initial scroll position
		handleScroll();

		return () => {
			window.removeEventListener('scroll', handleScroll);
			window.removeEventListener('resize', updateMeasurements);
		};
	});
</script>

<div bind:this={containerEl} style="position: relative; height: {totalHeight}px; width: 100%;">
	<div style="position: absolute; top: {offsetY}px; width: 100%;">
		{#each visibleItems as item, i (items.indexOf(item))}
			{@render children(item, startIndex + i)}
		{/each}
	</div>
</div>
