<script lang="ts">
	import type { ScheduleShow } from '$lib/server/queries/schedule';

	interface Props {
		shows: ScheduleShow[];
		onselect: (showRatingKey: string | null) => void;
		selected: string | null;
	}

	let { shows, onselect, selected }: Props = $props();

	function posterUrl(show: ScheduleShow): string | null {
		if (!show.thumb) return null;
		const params = new URLSearchParams({
			server: show.serverId,
			path: show.thumb,
			w: '80',
			h: '120'
		});
		return `/api/image?${params}`;
	}
</script>

<ul class="flex flex-col gap-1">
	{#each shows as show (show.id)}
		{@const poster = posterUrl(show)}
		{@const open = selected === show.showRatingKey}
		<li class="rounded-lg border {show.holes > 0 ? '' : 'border-transparent'}">
			<button
				type="button"
				onclick={() => onselect(open ? null : show.showRatingKey)}
				class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/40"
				aria-expanded={open}
			>
				<div class="size-10 shrink-0 overflow-hidden rounded-md bg-muted">
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
					<div class="flex items-baseline gap-2">
						<span class="truncate text-sm font-medium">{show.showTitle}</span>
						{#if show.holes > 0}
							<!-- Called out separately from the total: a hole means a file you
							     skipped past actually failed, which a raw "12 missing" hides. -->
							<span
								class="tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
								style="background-color: color-mix(in oklch, var(--hole) 18%, transparent); color: var(--hole)"
							>
								{show.holes}
								{show.holes === 1 ? 'gap' : 'gaps'}
							</span>
						{/if}
					</div>
					<div class="tabular truncate text-xs text-muted-foreground">
						{show.held} held<span class="px-1">·</span>{show.missing} missing
						{#if show.upcoming > 0}
							<span class="px-1">·</span>{show.upcoming} upcoming
						{/if}
					</div>
				</div>
			</button>

			{#if open}
				<!-- Per-season shape. This is the answer to "do I have the first two
				     and nothing after, or is something punched out of the middle" —
				     a count alone can't distinguish those. -->
				<div class="flex flex-col gap-2 px-2 pt-1 pb-3">
					{#each show.seasons as season (season.season)}
						<div class="rounded-md bg-muted/40 px-3 py-2 text-xs">
							<div class="mb-1 flex items-baseline gap-2">
								<span class="font-medium">Season {season.season}</span>
								<span class="tabular text-muted-foreground">
									{season.held} of {season.aired} aired
								</span>
								{#if season.holes > 0}
									<span class="tabular ml-auto" style="color: var(--hole)">
										{season.holes}
										{season.holes === 1 ? 'gap' : 'gaps'}
									</span>
								{/if}
							</div>
							{#if season.heldRuns}
								<div class="tabular text-muted-foreground">
									<span class="text-foreground">have</span>
									{season.heldRuns}
								</div>
							{/if}
							{#if season.missingRuns}
								<div class="tabular text-muted-foreground">
									<span style="color: var(--hole)">need</span>
									{season.missingRuns}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</li>
	{/each}
</ul>
