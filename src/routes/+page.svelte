<script lang="ts">
	import Nav from '$lib/components/Nav.svelte';
	import OnAir from '$lib/components/home/OnAir.svelte';
	import ActivityStrip from '$lib/components/home/ActivityStrip.svelte';
	import { Button } from '$lib/components/ui/button';
	import { formatBytes } from '$lib/components/quality/format';
	import { createSync } from '$lib/sync.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const sync = createSync();

	function gapPoster(gap: { serverId: string; thumb: string | null }): string | null {
		if (!gap.thumb) return null;
		const params = new URLSearchParams({
			server: gap.serverId,
			path: gap.thumb,
			w: '80',
			h: '120'
		});
		return `/api/image?${params}`;
	}
	const home = $derived(data.home);

	const neverSynced = $derived(data.servers.length === 0 || home.sync.items === 0);

	function ago(seconds: number | null): string {
		if (!seconds) return 'never';
		const delta = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
		if (delta < 90) return 'just now';
		if (delta < 3600) return `${Math.round(delta / 60)} min ago`;
		if (delta < 86_400) return `${Math.round(delta / 3600)}h ago`;
		return `${Math.round(delta / 86_400)}d ago`;
	}

	/**
	 * File sizes only exist for items a sync has walked since the media columns
	 * were added, so a byte total can cover a small fraction of the library. Below
	 * near-complete coverage the number is worse than useless — it looks
	 * authoritative while understating the collection by orders of magnitude — so
	 * it's withheld and the hint says why.
	 */
	const sizesTrustworthy = $derived(
		home.tiles.totalItems > 0 && home.tiles.sizedItems / home.tiles.totalItems >= 0.9
	);

	function bytes(value: number | null): string {
		if (value == null || !sizesTrustworthy) return '—';
		return formatBytes(value);
	}

	const measuredHint = $derived(
		`${home.tiles.sizedItems.toLocaleString()} of ${home.tiles.totalItems.toLocaleString()} measured · full sync`
	);

	const tiles = $derived([
		{
			label: 'Watched',
			value: home.tiles.watchedThisWeek.toLocaleString(),
			hint: home.tiles.streak > 0 ? `${home.tiles.streak}-day streak` : 'this week'
		},
		{
			label: 'Added',
			value: home.tiles.addedThisWeek.toLocaleString(),
			hint: sizesTrustworthy ? `this week · ${bytes(home.tiles.addedBytesThisWeek)}` : 'this week'
		},
		{
			label: 'On disk',
			value: bytes(home.tiles.totalBytes),
			hint: sizesTrustworthy
				? `+${formatBytes(home.tiles.bytesLast30Days ?? 0)} / 30d`
				: measuredHint
		},
		{
			label: 'In band',
			value: home.tiles.inBandPercent == null ? '—' : `${Math.round(home.tiles.inBandPercent)}%`,
			hint:
				home.tiles.inBandPercent == null
					? 'no file details yet'
					: `${Math.round(home.tiles.overkillPercent ?? 0)}% overkill · ${home.tiles.scoredItems.toLocaleString()} judged`
		}
	]);
</script>

<div class="mx-auto min-h-svh w-full max-w-5xl px-4 pb-24 sm:px-6">
	<Nav
		syncing={sync.syncing}
		onsync={() => sync.run()}
		servers={data.servers}
		serverScope={data.serverScope}
		viewers={data.viewers}
		userScope={data.userScope}
	/>

	{#if sync.message}
		<p
			class="mb-4 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
			role="status"
		>
			{sync.message}
		</p>
	{/if}

	{#if neverSynced}
		<div class="rounded-xl border border-dashed p-10 text-center">
			<h2 class="font-medium">Nothing synced yet</h2>
			<p class="mx-auto mt-2 max-w-md text-sm text-balance text-muted-foreground">
				Pull your watch history and libraries to get started. The first run walks everything and
				takes a minute or two.
			</p>
			<Button class="mt-5" onclick={() => sync.run(true)} disabled={sync.syncing}>
				{sync.syncing ? 'Syncing…' : 'Sync everything'}
			</Button>
		</div>
	{:else}
		<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<div class="rounded-xl border p-4 sm:p-5">
				<OnAir episodes={home.onAir} counts={home.onAirCounts} timeZone={data.timeZone} />
			</div>

			<aside class="flex flex-col gap-4">
				<section class="rounded-xl border p-4 sm:p-5">
					<div class="mb-2 flex items-baseline gap-2">
						<h2 class="text-sm font-medium">Gaps</h2>
						{#if home.gapTotal > 0}
							<span class="tabular ml-auto text-xs text-muted-foreground">{home.gapTotal}</span>
						{/if}
					</div>

					{#if home.gapTotal === 0}
						<p class="text-xs text-muted-foreground">Every season runs unbroken.</p>
					{:else}
						<ul class="flex flex-col">
							{#each home.gaps as gap (gap.id)}
								{@const poster = gapPoster(gap)}
								<li class="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
									<div
										class="size-10 shrink-0 overflow-hidden rounded-md bg-muted"
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
									<div class="min-w-0 flex-1">
										<div class="truncate text-sm font-medium">{gap.showTitle}</div>
										<div class="tabular truncate text-xs text-muted-foreground">
											S{String(gap.season).padStart(2, '0')} · {gap.episodes}
										</div>
									</div>
								</li>
							{/each}
						</ul>
						{#if home.gapTotal > home.gaps.length}
							<p class="mt-1 px-1 text-xs text-muted-foreground">
								+{home.gapTotal - home.gaps.length} more
							</p>
						{/if}
					{/if}
				</section>

				<section class="rounded-xl border p-4 sm:p-5">
					<ActivityStrip days={home.activityDays} timeZone={data.timeZone} weeks={8} />
				</section>
			</aside>
		</div>

		<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{#each tiles as tile (tile.label)}
				<div class="rounded-xl border bg-card/50 p-4">
					<div class="text-xs text-muted-foreground">{tile.label}</div>
					<div class="tabular mt-1 text-2xl font-semibold tracking-tight">{tile.value}</div>
					<div class="mt-0.5 truncate text-[11px] text-muted-foreground">{tile.hint}</div>
				</div>
			{/each}
		</div>

		<p class="tabular mt-8 border-t pt-4 text-xs text-muted-foreground">
			Synced {ago(home.sync.lastSyncedAt)} · {home.sync.plays.toLocaleString()} plays · {home.sync.items.toLocaleString()}
			items · {home.sync.showsChecked.toLocaleString()} of {home.sync.showsIdentified.toLocaleString()}
			shows checked
			{#if home.sync.unowned.length > 0}
				<br />
				{home.sync.unowned.join(', ')} not checked — shared servers can't report other users
			{/if}
		</p>
	{/if}
</div>
