<script lang="ts">
	import { formatDayLong, relativeDay, daysBetween, todayKey } from '$lib/activity/dates';

	interface Episode {
		id: string;
		serverId: string;
		showTitle: string;
		thumb: string | null;
		season: number;
		episode: number;
		title: string | null;
		airDate: string;
	}

	interface Props {
		items: Episode[];
		timeZone: string;
		/** Flips the age column from "3d ago" to "in 3 days" — the same rows read
		 *  as a backlog or as a schedule depending on which side of today they
		 *  fall, and the label is what tells you which. */
		upcoming?: boolean;
	}

	let { items, timeZone, upcoming = false }: Props = $props();

	const today = $derived(todayKey(timeZone));

	function posterUrl(item: Episode): string | null {
		if (!item.thumb) return null;
		const params = new URLSearchParams({
			server: item.serverId,
			path: item.thumb,
			w: '80',
			h: '120'
		});
		return `/api/image?${params}`;
	}

	function code(item: Episode): string {
		return `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;
	}

	function age(item: Episode): string {
		const days = daysBetween(today, item.airDate);
		if (days <= 0) return relativeDay(item.airDate, today);
		if (days === 1) return 'tomorrow';
		if (days < 14) return `in ${days} days`;
		if (days < 60) return `in ${Math.round(days / 7)} weeks`;
		return `in ${Math.round(days / 30)} months`;
	}
</script>

<ol class="flex flex-col">
	{#each items as item (item.id)}
		{@const poster = posterUrl(item)}
		<li class="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40">
			<div
				class="relative size-11 shrink-0 overflow-hidden rounded-md bg-muted"
				style="box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--foreground) 8%, transparent)"
			>
				{#if poster}
					<img src={poster} alt="" loading="lazy" decoding="async" class="size-full object-cover" />
				{/if}
			</div>

			<div class="min-w-0 flex-1">
				<div class="truncate text-sm font-medium">{item.showTitle}</div>
				<div class="truncate text-xs text-muted-foreground">
					<span class="tabular text-foreground">{code(item)}</span>
					{#if item.title}
						<span class="px-1">·</span>{item.title}
					{/if}
				</div>
			</div>

			<div class="shrink-0 text-right">
				<div class="tabular text-xs" title={formatDayLong(item.airDate)}>{item.airDate}</div>
				<div class="text-[11px] {upcoming ? 'text-plex' : 'text-muted-foreground'}">
					{age(item)}
				</div>
			</div>
		</li>
	{/each}
</ol>
