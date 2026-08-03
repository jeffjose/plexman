<script lang="ts">
	/**
	 * The Plexman mark — the same glyph as `static/favicon.svg`, inlined so it
	 * takes `currentColor` and scales with surrounding text instead of being a
	 * fixed-size raster.
	 *
	 * Duotone: the screen front is solid, the side/stand panel sits at 60% so the
	 * shape reads at 20px without any stroke work.
	 */
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="currentColor"
	aria-hidden="true"
	class={className}
	xmlns="http://www.w3.org/2000/svg"
>
	<path
		fill-rule="evenodd"
		d="M16 6H8c-2.828 0-4.243 0-5.121.879C2 7.757 2 9.172 2 12v4c0 2.828 0 4.243.879 5.121C3.757 22 5.172 22 8 22h8z"
		clip-rule="evenodd"
	/>
	<path
		fill-opacity="0.6"
		d="M22 12v4c0 2.828 0 4.242-.879 5.121c-.825.825-2.123.876-4.621.879H16V6h.5c2.498.003 3.796.053 4.621.878C22 7.758 22 9.171 22 12m-8.584-6l2.153-2.512a.75.75 0 0 0-1.138-.976L12 5.348L9.57 2.512a.75.75 0 0 0-1.14.976L10.585 6z"
	/>
	<path d="M19 11a1 1 0 1 1 0 2a1 1 0 0 1 0-2m0 4a1 1 0 1 1 0 2a1 1 0 0 1 0-2" />
</svg>
