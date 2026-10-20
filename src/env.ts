import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: {
		description:
			'libSQL URL of the local SQLite cache, e.g. `file:local.db` (relative paths resolve from the project root). See .env.example.',
		schema: (value) => {
			if (!value) throw new Error('DATABASE_URL is not set — see .env.example');
			return value;
		}
	}
});
