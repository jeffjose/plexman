<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	/**
	 * The server / viewer selector.
	 *
	 * One control rather than two because the two are dependent: a viewer belongs
	 * to a server, so picking a person on a server you aren't looking at is
	 * incoherent. Changing the server therefore clears the viewer back to you.
	 */
	interface Viewer {
		id: string;
		serverId: string;
		serverName: string;
		name: string;
		isSelf: boolean;
		historyCount: number;
	}

	interface Props {
		servers: { id: string; name: string; owned: boolean }[];
		serverScope: string[];
		viewers: Viewer[];
		userScope: string | null;
	}

	let { servers, serverScope, viewers, userScope }: Props = $props();

	const selectedServer = $derived(serverScope[0] ?? '');
	const serverLabel = $derived(
		servers.find((server) => server.id === selectedServer)?.name ?? 'All servers'
	);

	const viewerLabel = $derived.by(() => {
		if (userScope === 'all') return 'Everyone';
		if (!userScope) return null;
		return viewers.find((viewer) => viewer.id === userScope)?.name ?? 'Unknown user';
	});

	// Only worth offering when there's a genuine choice — a single-user server
	// would otherwise show a menu with one entry that does nothing.
	const showViewers = $derived(viewers.length > 1);

	function apply(params: Record<string, string | null>) {
		const next = new URL(page.url);
		for (const [key, value] of Object.entries(params)) {
			if (value === null) next.searchParams.delete(key);
			else next.searchParams.set(key, value);
		}
		// The selection changes what's being counted, so a day picked under the
		// previous scope no longer refers to anything.
		next.searchParams.delete('day');
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(next, { noScroll: true });
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="sm" class="gap-1.5 px-2 font-normal">
				<span class="max-w-40 truncate">{serverLabel}</span>
				{#if viewerLabel}
					<span class="text-muted-foreground">·</span>
					<span class="max-w-32 truncate text-muted-foreground">{viewerLabel}</span>
				{/if}
				<svg
					viewBox="0 0 12 12"
					class="size-3 text-muted-foreground"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="m3 4.5 3 3 3-3" />
				</svg>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content align="start" class="min-w-56">
		<DropdownMenu.Label class="text-[11px] font-normal text-muted-foreground">
			Server
		</DropdownMenu.Label>
		<DropdownMenu.RadioGroup
			value={selectedServer}
			onValueChange={(value) => apply({ server: value || 'all', user: null })}
		>
			<DropdownMenu.RadioItem value="">All servers</DropdownMenu.RadioItem>
			{#each servers as server (server.id)}
				<DropdownMenu.RadioItem value={server.id}>
					{server.name}
					{#if !server.owned}
						<span class="ml-auto pl-3 text-[11px] text-muted-foreground">shared</span>
					{/if}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>

		{#if showViewers}
			<DropdownMenu.Separator />
			<DropdownMenu.Label class="text-[11px] font-normal text-muted-foreground">
				Whose activity
			</DropdownMenu.Label>
			<DropdownMenu.RadioGroup
				value={userScope ?? 'me'}
				onValueChange={(value) => apply({ user: value === 'me' ? null : value })}
			>
				<DropdownMenu.RadioItem value="me">Me</DropdownMenu.RadioItem>
				<DropdownMenu.RadioItem value="all">Everyone</DropdownMenu.RadioItem>
				{#each viewers.filter((viewer) => !viewer.isSelf) as viewer (viewer.id)}
					<DropdownMenu.RadioItem value={viewer.id}>
						<span class="truncate">{viewer.name}</span>
						<span class="tabular ml-auto pl-3 text-[11px] text-muted-foreground">
							{viewer.historyCount.toLocaleString()}
						</span>
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
