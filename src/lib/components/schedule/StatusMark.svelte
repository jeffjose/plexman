<script lang="ts">
	import type { EpisodeStatus, GapKind } from '$lib/server/queries/schedule';

	/**
	 * The per-episode state marker.
	 *
	 * Three visually distinct treatments rather than three colours of the same
	 * shape: a filled check reads as "done" at a glance, a hollow ring as an
	 * unticked box, and a dashed ring as something that hasn't happened yet.
	 * Colour alone would leave the states indistinguishable to a good share of
	 * viewers.
	 */
	let {
		status,
		gap = null,
		class: className = ''
	}: { status: EpisodeStatus; gap?: GapKind | null; class?: string } = $props();

	const label = $derived(
		status === 'held'
			? 'On the server'
			: status === 'upcoming'
				? 'Not aired yet'
				: gap === 'hole'
					? 'Missing — gap inside a season you otherwise have'
					: gap === 'head'
						? 'Missing — before the earliest episode you have'
						: 'Missing'
	);
</script>

<span class="flex size-5 shrink-0 items-center justify-center {className}" title={label}>
	<span class="sr-only">{label}</span>

	{#if status === 'held'}
		<span
			class="flex size-4 items-center justify-center rounded-full"
			style="background-color: var(--held)"
			aria-hidden="true"
		>
			<svg
				viewBox="0 0 12 12"
				class="size-2.5 text-background"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M2.5 6.5 4.75 8.75 9.5 3.5" />
			</svg>
		</span>
	{:else if status === 'upcoming'}
		<!-- A clock face rather than a dashed ring: at 16px a dashed border renders
		     as an uneven scatter of pixels, and it read as a damaged circle rather
		     than a deliberate one. Solid stroke, same circle family as the rest. -->
		<svg
			viewBox="0 0 16 16"
			class="size-4 text-muted-foreground"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="8" cy="8" r="6.25" stroke-width="1.5" opacity="0.55" />
			<path d="M8 4.5V8l2.25 1.5" stroke-width="1.5" />
		</svg>
	{:else if gap === 'hole'}
		<!-- A hole is the one absence worth alarming about: you kept watching past
		     it, so the file genuinely failed rather than simply not existing yet. -->
		<span
			class="flex size-4 items-center justify-center rounded-full border-2"
			style="border-color: var(--hole)"
			aria-hidden="true"
		>
			<span class="size-1.5 rounded-full" style="background-color: var(--hole)"></span>
		</span>
	{:else}
		<span class="size-4 rounded-full border-2 border-muted-foreground/40" aria-hidden="true"></span>
	{/if}
</span>
