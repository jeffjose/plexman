import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
// Required and validated in src/env.ts, so it's always a non-empty string here.
import { DATABASE_URL } from '$app/env/private';

const client = createClient({ url: DATABASE_URL });

export const db = drizzle(client, { schema });
