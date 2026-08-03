<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Logo from './Logo.svelte';
	import Wordmark from './Wordmark.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	interface Props {
		syncing: boolean;
		onsync: () => void;
		servers: { id: string; name: string; owned: boolean }[];
		/** Resolved scope from the layout — the URL may be silent while a stored
		 *  preference is in force, and the selector must show what's really
		 *  being queried. */
		serverScope: string[];
	}

	let { syncing, onsync, servers, serverScope }: Props = $props();

	/** Empty string is the UI's "all servers"; the wire sentinel is `all`. */
	const selectedServer = $derived(serverScope[0] ?? '');

	/**
	 * Nav links carry the current scope.
	 *
	 * Without this, switching from Activity to Library would silently reset you
	 * to "All servers" — the selector would still read as scoped while the page
	 * below it showed everything.
	 */
	const NAV_LINKS = [
		{ path: '/', label: 'Activity' },
		{ path: '/library', label: 'Library' },
		{ path: '/quality', label: 'Quality' },
		{ path: '/unfinished', label: 'Unfinished' },
		{ path: '/schedule', label: 'Schedule' }
	] as const;

	type NavPath = (typeof NAV_LINKS)[number]['path'];

	function href(path: NavPath): string {
		const base = resolve(path);
		return selectedServer ? `${base}?server=${encodeURIComponent(selectedServer)}` : base;
	}

	const selectedLabel = $derived(
		servers.find((server) => server.id === selectedServer)?.name ?? 'All servers'
	);

	function selectServer(value: string) {
		const next = new URL(page.url);

		// `all` is sent explicitly: an absent parameter means "keep what you
		// remembered", so it could never express a choice to widen the scope.
		next.searchParams.set('server', value || 'all');

		// Scope changes what's being counted, so the day selection and the paging
		// cursor from the previous scope no longer mean anything.
		next.searchParams.delete('day');

		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(next, { noScroll: true });
	}
</script>

<header class="flex flex-wrap items-center gap-x-4 gap-y-2 py-6">
	<!-- `href()` already calls resolve(); the rule can't see through the helper.
	     Same for the nav links below. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a href={href('/')} class="flex items-center gap-2.5">
		<Logo class="size-5 text-plex" />
		<Wordmark class="text-[15px]" />
	</a>

	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<nav class="flex items-center gap-0.5">
		{#each NAV_LINKS as link (link.path)}
			{@const active = page.url.pathname === resolve(link.path)}
			<a
				href={href(link.path)}
				aria-current={active ? 'page' : undefined}
				class="rounded-md px-2.5 py-1 text-sm transition-colors {active
					? 'bg-accent font-medium text-accent-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				{link.label}
			</a>
		{/each}
	</nav>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->

	<div class="ml-auto flex items-center gap-2">
		<!-- Only worth showing when there's a choice to make. -->
		{#if servers.length > 1}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="outline" size="sm" class="gap-1.5 font-normal">
							{selectedLabel}
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

				<DropdownMenu.Content align="end" class="min-w-44">
					<DropdownMenu.RadioGroup
						value={selectedServer}
						onValueChange={(value) => selectServer(value)}
					>
						<DropdownMenu.RadioItem value="">All servers</DropdownMenu.RadioItem>
						<DropdownMenu.Separator />
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
		{/if}

		<Button variant="outline" size="sm" onclick={onsync} disabled={syncing}>
			{syncing ? 'Syncing…' : 'Sync'}
		</Button>
		<form method="POST" action="/auth/logout">
			<Button type="submit" variant="ghost" size="sm" class="text-muted-foreground">
				Sign out
			</Button>
		</form>
	</div>
</header>
