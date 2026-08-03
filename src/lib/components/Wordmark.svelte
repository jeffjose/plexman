<script lang="ts">
	/**
	 * The "plexman" lockup.
	 *
	 * Set lowercase and split into two weights of the same colour rather than two
	 * hues: the mark beside it already carries the amber, and a second accent in
	 * the wordmark would compete with it. `plex` is the part borrowed from
	 * elsewhere, `man` is what this app adds — dimming the second half is the
	 * same treatment kpopidols gives `aegyo.gg`.
	 */
	let { class: className = '' }: { class?: string } = $props();
</script>

<span class="tracking-tight lowercase {className}">
	<span class="font-semibold">plex</span><span class="font-normal text-muted-foreground">man</span>
</span>
