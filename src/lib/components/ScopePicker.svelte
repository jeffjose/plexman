<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	/**
	 * Server and viewer, as two adjacent dropdowns.
	 *
	 * Separate triggers rather than one combined menu: they answer different
	 * questions ("which box" and "whose viewing"), and a single label reading
	 * "plexagon · Everyone" made the second half easy to miss. They stay coupled
	 * in behaviour — changing the server resets the viewer, because a person
	 * belongs to a server and the pairing would otherwise be incoherent.
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

	const self = $derived(viewers.find((viewer) => viewer.isSelf) ?? null);

	/**
	 * A null preference means "me", but the menu has to put the radio somewhere,
	 * so it resolves to your own row. Picking that row explicitly stores the same
	 * scope the default already implied.
	 */
	const selectedViewer = $derived(userScope ?? self?.id ?? 'all');

	const viewerLabel = $derived(
		selectedViewer === 'all'
			? 'Everyone'
			: (viewers.find((viewer) => viewer.id === selectedViewer)?.name ?? 'Me')
	);

	/**
	 * One aggregate, then people by how much they actually watch.
	 *
	 * The previous order — Me, Everyone, then the rest — mixed a scope with a
	 * person and buried the ranking. Sorting by play count puts the account you
	 * use at the top on its own merit rather than by special-casing it.
	 */
	const people = $derived([...viewers].sort((a, b) => b.historyCount - a.historyCount));

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

{#snippet chevron()}
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
{/snippet}

<div class="flex items-center gap-1">
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="ghost" size="sm" class="gap-1.5 px-2 font-normal">
					<span class="max-w-36 truncate">{serverLabel}</span>
					{@render chevron()}
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>

		<DropdownMenu.Content align="start" class="min-w-48">
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
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	<!-- Only worth a control when there's more than one person to choose from. -->
	{#if viewers.length > 1}
		<span class="text-xs text-muted-foreground" aria-hidden="true">·</span>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="sm" class="gap-1.5 px-2 font-normal">
						<span class="max-w-32 truncate">{viewerLabel}</span>
						{@render chevron()}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>

			<DropdownMenu.Content align="start" class="min-w-52">
				<DropdownMenu.RadioGroup
					value={selectedViewer}
					onValueChange={(value) => apply({ user: value })}
				>
					<DropdownMenu.RadioItem value="all">Everyone</DropdownMenu.RadioItem>
					<DropdownMenu.Separator />
					{#each people as viewer (viewer.id)}
						<DropdownMenu.RadioItem value={viewer.id}>
							<span class="truncate">{viewer.name}</span>
							{#if viewer.isSelf}
								<span class="pl-1.5 text-[11px] text-muted-foreground">you</span>
							{/if}
							<span
								class="tabular ml-auto pl-3 text-[11px] {viewer.historyCount === 0
									? 'text-muted-foreground/50'
									: 'text-muted-foreground'}"
							>
								{viewer.historyCount.toLocaleString()}
							</span>
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/if}
</div>
