<script lang="ts">
	import '../app.css';
	import { refreshAll } from '$app/navigation';
	import { browser } from '$app/env';
	import { createActivityPoll, setActivityPoll } from '#lib/sync.svelte.js';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	/**
	 * Keep the page current without anyone pressing anything.
	 *
	 * It lives in the layout rather than on a page because every view is a
	 * different reading of the same data — an episode finishing should land on
	 * whichever one you happen to be looking at. Signed-out visitors have nothing
	 * to poll for, and the endpoint would 401 at them every 90 seconds.
	 */
	const activity = setActivityPoll(createActivityPoll());

	// Reading the id rather than the account object: `data` is replaced on every
	// load, so depending on the object itself would restart the poll each time one
	// of its own polls invalidated the page.
	const accountId = $derived(data.account?.id ?? null);

	$effect(() => {
		if (accountId === null) return;
		return activity.start();
	});

	/**
	 * Tell the server which zone to bucket history into.
	 *
	 * The heatmap is a grid of local days, so the server has to agree with the
	 * browser about where a day starts. It guesses its own zone on the very first
	 * request; once we know better we write the cookie and re-run the load — but
	 * only when the guess was actually wrong, so the common case costs nothing.
	 */
	$effect(() => {
		if (!browser) return;

		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!zone || zone === data.timeZone) return;

		document.cookie = `plexman_tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
		refreshAll();
	});
</script>

<svelte:head>
	<title>Plexman</title>
	<meta name="description" content="See what you watched on Plex, and when." />
	<!-- Icons and manifest are declared once in src/app.html — see the note there.
	     An icon link here would land after those and, being an SVG, would outrank
	     the .ico regardless of which one is actually current. -->
</svelte:head>

{@render children()}
