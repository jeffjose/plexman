<script lang="ts">
	import { formatDayLong } from '$lib/activity/dates';
	import { TYPE_LABELS, type MediaType } from '$lib/activity/types';

	interface Props {
		total: number;
		activeDays: number;
		currentStreak: number;
		longestStreak: number;
		busiestDay: { date: string; count: number } | null;
		byType: Record<MediaType, number>;
	}

	let { total, activeDays, currentStreak, longestStreak, busiestDay, byType }: Props = $props();

	const compact = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1
	});

	const stats = $derived([
		{ label: 'Items watched', value: total.toLocaleString(), hint: null },
		{ label: 'Active days', value: activeDays.toLocaleString(), hint: null },
		{
			label: 'Current streak',
			value: `${currentStreak}d`,
			hint: longestStreak > 0 ? `best ${longestStreak}d` : null
		},
		{
			label: 'Busiest day',
			value: busiestDay ? String(busiestDay.count) : '—',
			hint: busiestDay ? formatDayLong(busiestDay.date).replace(/^\w+, /, '') : null
		}
	]);

	// Non-zero types only — a bar segment for a type you've never watched is
	// noise, and an empty legend row is worse.
	const present = $derived(
		(Object.entries(byType) as [MediaType, number][]).filter(([, count]) => count > 0)
	);
</script>

<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
	{#each stats as stat (stat.label)}
		<div class="rounded-xl border bg-card/50 p-4">
			<div class="text-xs text-muted-foreground">{stat.label}</div>
			<div class="tabular mt-1 text-2xl font-semibold tracking-tight">{stat.value}</div>
			{#if stat.hint}
				<div class="mt-0.5 truncate text-[11px] text-muted-foreground">{stat.hint}</div>
			{/if}
		</div>
	{/each}
</div>

{#if present.length > 0}
	<div class="mt-3 flex flex-col gap-2">
		<!-- Proportional bar: the split between movies, episodes and music at a
		     glance, without a chart library. -->
		<div class="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
			{#each present as [type, count] (type)}
				<div
					style="width: {(count / total) * 100}%; background-color: var(--type-{type})"
					class="h-full"
				></div>
			{/each}
		</div>
		<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
			{#each present as [type, count] (type)}
				<span class="flex items-center gap-1.5">
					<span
						class="size-2 rounded-full"
						style="background-color: var(--type-{type})"
						aria-hidden="true"
					></span>
					<span>{TYPE_LABELS[type]}</span>
					<span class="tabular font-medium text-foreground">{compact.format(count)}</span>
				</span>
			{/each}
		</div>
	</div>
{/if}
