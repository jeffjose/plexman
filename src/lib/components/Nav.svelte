<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Logo from './Logo.svelte';
	import ScopePicker from './ScopePicker.svelte';
	import Wordmark from './Wordmark.svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		syncing: boolean;
		onsync: () => void;
		servers: { id: string; name: string; owned: boolean }[];
		/** Resolved scope from the layout — the URL may be silent while a stored
		 *  preference is in force, and the selector must show what's really
		 *  being queried. */
		serverScope: string[];
		viewers: {
			id: string;
			serverId: string;
			serverName: string;
			name: string;
			isSelf: boolean;
			historyCount: number;
		}[];
		userScope: string | null;
	}

	let { syncing, onsync, servers, serverScope, viewers, userScope }: Props = $props();

	const NAV_LINKS = [
		{ path: '/', label: 'Home' },
		{ path: '/activity', label: 'Activity' },
		{ path: '/library', label: 'Library' },
		{ path: '/quality', label: 'Quality' },
		{ path: '/unfinished', label: 'Unfinished' },
		{ path: '/schedule', label: 'Schedule' }
	] as const;

	type NavPath = (typeof NAV_LINKS)[number]['path'];

	/** Plain links — scope is remembered per account, so it survives navigation
	 *  without every URL having to restate it. */
	function href(path: NavPath): string {
		return resolve(path);
	}
</script>

<header class="flex flex-wrap items-center gap-x-4 gap-y-2 py-6">
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a href={href('/')} class="flex items-center gap-2.5">
		<Logo class="size-5 text-plex" />
		<Wordmark class="text-[15px]" />
	</a>

	<!-- Scope sits beside the mark rather than in the trailing controls: it says
	     what you're looking at, which belongs with the title, not with the
	     actions. -->
	<ScopePicker {servers} {serverScope} {viewers} {userScope} />

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
