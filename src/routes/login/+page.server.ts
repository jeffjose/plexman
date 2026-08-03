import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const ERROR_MESSAGES: Record<string, string> = {
	missing_pin: 'That sign-in attempt expired. Try again.',
	pin_check_failed: "Couldn't reach plex.tv to finish signing in. Try again.",
	not_authorized: 'Sign-in was cancelled or the code expired.'
};

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.account) redirect(303, '/');

	const code = url.searchParams.get('error');
	return { error: code ? (ERROR_MESSAGES[code] ?? 'Sign-in failed. Try again.') : null };
};
