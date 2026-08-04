<script lang="ts">
	interface Props {
		/** One entry per owned episode in broadcast order; true where played. */
		markers: boolean[];
		/** Index of the episode last played, or -1. */
		resumeIndex: number;
	}

	let { markers, resumeIndex }: Props = $props();

	/**
	 * Dots drawn before the strip starts sampling.
	 *
	 * A show with 248 episodes can't be drawn one dot per episode at any useful
	 * size, and wouldn't be worth reading if it could. Past this the strip keeps
	 * the three places that carry meaning — how it started, where you stopped,
	 * and how far there is left — and elides the runs between.
	 */
	const MAX_DOTS = 32;
	const EDGE = 8;
	const AROUND_RESUME = 10;

	interface Segment {
		/** Dots to draw, with their original index so the resume point survives
		 *  the elision. */
		dots: { index: number; watched: boolean }[];
		/** Episodes skipped immediately before this segment. */
		gap: number;
	}

	const segments = $derived.by<Segment[]>(() => {
		const all = markers.map((watched, index) => ({ index, watched }));
		if (all.length <= MAX_DOTS) return [{ dots: all, gap: 0 }];

		// Three windows: the opening, where you left off, and the tail. They're
		// merged when they touch, so a resume point near either end doesn't
		// produce a one-dot island next to a gap of two.
		const pivot = resumeIndex >= 0 ? resumeIndex : 0;
		const ranges: [number, number][] = [
			[0, EDGE],
			[
				Math.max(0, pivot - Math.floor(AROUND_RESUME / 2)),
				Math.min(all.length, pivot + Math.ceil(AROUND_RESUME / 2))
			],
			[all.length - EDGE, all.length]
		]
			.map(([start, end]) => [Math.max(0, start), Math.min(all.length, end)] as [number, number])
			.filter(([start, end]) => end > start)
			.sort((a, b) => a[0] - b[0]);

		const merged: [number, number][] = [];
		for (const range of ranges) {
			const last = merged.at(-1);
			// Touching or overlapping — and a gap of one is not worth an ellipsis
			// wider than the dot it replaces.
			if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
			else merged.push([...range]);
		}

		return merged.map(([start, end], i) => ({
			dots: all.slice(start, end),
			gap: i === 0 ? 0 : start - merged[i - 1][1]
		}));
	});
</script>

<div class="flex flex-wrap items-center gap-x-1 gap-y-1" aria-hidden="true">
	{#each segments as segment, segmentIndex (segmentIndex)}
		{#if segment.gap > 0}
			<span class="tabular px-0.5 text-[10px] text-muted-foreground">⋯{segment.gap}</span>
		{/if}
		{#each segment.dots as dot (dot.index)}
			<!-- Filled for played, hollow for not — the same vocabulary the Schedule
			     page uses for held versus missing, so the shapes mean one thing
			     across the app. The resume point gets a ring so "how far did I get"
			     is findable without counting. -->
			<span
				class="size-2 shrink-0 rounded-full {dot.watched
					? 'bg-foreground/70'
					: 'border border-muted-foreground/40'} {dot.index === resumeIndex
					? 'ring-1 ring-foreground ring-offset-1 ring-offset-background'
					: ''}"
			></span>
		{/each}
	{/each}
</div>
