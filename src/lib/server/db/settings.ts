import { eq } from 'drizzle-orm';
import { db } from './index';
import { settings } from './schema';

export async function getSetting(key: string): Promise<string | null> {
	const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
	return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await db
		.insert(settings)
		.values({ key, value, updatedAt: now })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
}
