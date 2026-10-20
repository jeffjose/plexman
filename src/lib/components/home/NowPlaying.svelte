<script lang="ts">
	import ViewerBadge from '#lib/components/activity/ViewerBadge.svelte';
	import type { LiveSession } from '#lib/sync.svelte.js';

	interface Props {
		sessions: LiveSession[];
		/** False until the first poll answers. Distinguishes "nobody is watching"
		 *  from "we haven't asked yet" — without it the panel would assert an empty
		 *  house for the first second of every page load. */
		known?: boolean;
	}

	let { sessions, known = false }: Props = $props();

	function posterUrl(session: LiveSession): string | null {
		if (!session.thumb) return null;
		const params = new URLSearchParams({
			server: session.serverId,
			path: session.thumb,
			w: '160',
			h: '240'
		});
		return `/api/image?${params}`;
	}

	/**
	 * The session's user, shaped like a timeline viewer.
	 *
	 * Keyed on the name, which is what `viewerColors` hashes — so the same person
	 * is the same colour here and in the activity timeline, even though a session
	 * reports a plex.tv title and a history row a server-local account id.
	 */
	function viewerOf(session: LiveSession) {
		if (!session.user) return null;
		return { id: `${session.serverId}:${session.user}`, name: session.user };
	}

	function subtitle(session: LiveSession): string | null {
		if (session.type === 'episode' && session.parentIndex != null && session.index != null) {
			const code = `S${String(session.parentIndex).padStart(2, '0')}E${String(session.index).padStart(2, '0')}`;
			return `${code} · ${session.title}`;
		}
		return session.parentTitle;
	}

	function remaining(session: LiveSession): string | null {
		if (session.remainingMs == null) return null;
		const minutes = Math.round(session.remainingMs / 60_000);
		if (minutes < 1) return 'finishing';
		if (minutes < 60) return `${minutes} min left`;
		const hours = Math.floor(minutes / 60);
		return `${hours}h ${minutes % 60}m left`;
	}
</script>

<section class="rounded-xl border bg-card/60 p-4 sm:p-5">
	<div class="mb-3 flex items-baseline gap-2">
		<h2 class="flex items-center gap-2 text-sm font-medium">
			{#if sessions.length > 0}
				<!-- A live indicator earns its animation here: it's the one thing on the
				     page that is true only right now. -->
				<span class="relative flex size-2" aria-hidden="true">
					<span
						class="absolute inline-flex size-full animate-ping rounded-full opacity-75"
						style="background-color: var(--type-episode)"
					></span>
					<span
						class="relative inline-flex size-2 rounded-full"
						style="background-color: var(--type-episode)"
					></span>
				</span>
			{/if}
			Now playing
		</h2>
		{#if sessions.length > 0}
			<span class="ml-auto text-xs text-muted-foreground">
				{sessions.length === 1 ? '1 stream' : `${sessions.length} streams`}
			</span>
		{/if}
	</div>

	{#if sessions.length === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">
			{known ? 'Nobody’s watching anything right now.' : 'Checking…'}
		</p>
	{:else}
		<!-- Two across once there's room: several people watching at once is the
		     case this panel exists for, and a vertical list buries the second one. -->
		<ul class="grid gap-3 {sessions.length > 1 ? 'lg:grid-cols-2' : ''}">
			{#each sessions as session (session.serverId + session.key)}
				{@const poster = posterUrl(session)}
				{@const detail = subtitle(session)}
				{@const left = remaining(session)}
				<li class="flex items-center gap-3.5 rounded-lg bg-muted/30 p-2.5">
					<div
						class="h-[4.5rem] w-12 shrink-0 overflow-hidden rounded-md bg-muted"
						style="box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--foreground) 8%, transparent)"
					>
						{#if poster}
							<img
								src={poster}
								alt=""
								loading="lazy"
								decoding="async"
								class="size-full object-cover"
							/>
						{/if}
					</div>

					<div class="flex min-w-0 flex-1 flex-col gap-1">
						<div class="flex items-baseline gap-2">
							<span class="truncate text-base font-medium">
								{session.grandparentTitle ?? session.title}
							</span>
							{#if session.state === 'paused'}
								<span class="shrink-0 text-[11px] text-muted-foreground">paused</span>
							{/if}
						</div>

						{#if detail}
							<div class="truncate text-xs text-muted-foreground">{detail}</div>
						{/if}

						{#if session.progress != null}
							<!-- A bar rather than a percentage: the useful question is "are they
							     nearly done", which a filled length answers at a glance. -->
							<div class="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full"
									style="width: {(session.progress * 100).toFixed(
										1
									)}%; background-color: {session.state === 'paused'
										? 'color-mix(in oklch, var(--foreground) 35%, transparent)'
										: 'var(--type-episode)'}"
								></div>
							</div>
						{/if}

						<div class="flex items-center gap-2 pt-0.5">
							<ViewerBadge viewer={viewerOf(session)} showName size="md" class="min-w-0" />
							{#if left}
								<span class="tabular ml-auto shrink-0 text-xs text-muted-foreground">{left}</span>
							{/if}
						</div>

						{#if session.player}
							<div class="truncate text-[11px] text-muted-foreground">{session.player}</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
