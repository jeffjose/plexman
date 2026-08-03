<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import Logo from '$lib/components/Logo.svelte';
	import Wordmark from '$lib/components/Wordmark.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let signingIn = $state(false);
</script>

<main class="relative flex min-h-svh items-center justify-center overflow-hidden px-6">
	<!-- Ambient wash behind the card. Purely decorative, so it's hidden from
	     assistive tech and skipped when the user prefers reduced motion. -->
	<div
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 [background:radial-gradient(60rem_40rem_at_50%_-10%,color-mix(in_oklch,var(--plex)_14%,transparent),transparent_70%)]"
	></div>

	<div class="relative w-full max-w-sm">
		<div class="mb-10 flex flex-col items-center text-center">
			<Logo class="mb-5 size-11 text-plex" />
			<h1 class="text-2xl"><Wordmark /></h1>
			<p class="mt-2 text-sm text-balance text-muted-foreground">
				See everything you've watched on Plex, laid out by day.
			</p>
		</div>

		{#if data.error}
			<p
				class="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
				role="alert"
			>
				{data.error}
			</p>
		{/if}

		<!-- A plain link, not fetch(): the PIN endpoint sets a cookie and then
		     redirects to plex.tv, which has to be a top-level navigation. -->
		<Button
			href="/auth/plex"
			size="lg"
			class="w-full bg-plex font-medium text-plex-foreground hover:bg-plex/90"
			onclick={() => (signingIn = true)}
			data-sveltekit-preload-data="off"
		>
			{signingIn ? 'Redirecting to Plex…' : 'Sign in with Plex'}
		</Button>

		<p class="mt-6 text-center text-xs leading-relaxed text-balance text-muted-foreground">
			You'll approve access on plex.tv. Plexman stores your watch history locally and never sends it
			anywhere.
		</p>
	</div>
</main>
