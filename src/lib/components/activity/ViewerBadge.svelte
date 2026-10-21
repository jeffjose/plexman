<script lang="ts">
	import { viewerColors, viewerInitials } from '$lib/activity/viewers';
	import type { Viewer } from '$lib/activity/types';

	interface Props {
		viewer: Viewer | null;
		/** Show the name beside the badge. Off in dense lists, where the colour
		 *  carries the identity and the name is available on hover. */
		showName?: boolean;
		/** Bigger badge for the Now playing panel, where a row is a headline rather
		 *  than one of sixty. */
		size?: 'sm' | 'md';
		class?: string;
	}

	let { viewer, showName = false, size = 'sm', class: className = '' }: Props = $props();

	const colors = $derived(viewer ? viewerColors(viewer.name) : null);
</script>

<span
	class="flex min-w-0 items-center gap-1.5 {className}"
	title={viewer?.name ?? 'Unknown viewer'}
>
	<span
		class="grid shrink-0 place-items-center rounded-full font-semibold tabular-nums {size === 'md'
			? 'size-6 text-[10px]'
			: 'size-5 text-[9px]'}"
		style={colors
			? `background-color: ${colors.background}; color: ${colors.ink}`
			: 'background-color: color-mix(in oklch, var(--foreground) 20%, transparent); color: var(--foreground)'}
		aria-hidden="true"
	>
		{viewer ? viewerInitials(viewer.name) : '?'}
	</span>
	{#if showName}
		<span class="truncate text-xs text-muted-foreground">{viewer?.name ?? 'Unknown'}</span>
	{:else}
		<!-- The colour alone is the identity for sighted users; screen readers get
		     the name rather than a decorative dot they can't interpret. -->
		<span class="sr-only">{viewer?.name ?? 'Unknown viewer'}</span>
	{/if}
</span>
