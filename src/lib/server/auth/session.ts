/**
 * Session handling.
 *
 * Deliberately minimal: a random opaque id in an httpOnly cookie, and a row
 * that maps it to a Plex account. The Plex auth token stays in the database.
 * Plex tokens don't expire on their own, so session lifetime is our own policy
 * rather than something we inherit.
 */

import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db } from '../db';
import { accounts, sessions, type Account } from '../db/schema';

export const SESSION_COOKIE = 'plexman_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90;

export async function createSession(accountId: number): Promise<string> {
	const id = randomBytes(32).toString('base64url');
	const now = Math.floor(Date.now() / 1000);

	await db.insert(sessions).values({
		id,
		accountId,
		createdAt: now,
		expiresAt: now + SESSION_TTL_SECONDS
	});

	// Opportunistic cleanup — cheap, and saves needing a scheduled job for a
	// table that only ever holds a handful of rows.
	await db.delete(sessions).where(lt(sessions.expiresAt, now));

	return id;
}

export async function resolveSession(sessionId: string | undefined): Promise<Account | null> {
	if (!sessionId) return null;

	const [row] = await db
		.select({ account: accounts, expiresAt: sessions.expiresAt })
		.from(sessions)
		.innerJoin(accounts, eq(sessions.accountId, accounts.id))
		.where(eq(sessions.id, sessionId))
		.limit(1);

	if (!row) return null;

	if (row.expiresAt < Math.floor(Date.now() / 1000)) {
		await db.delete(sessions).where(eq(sessions.id, sessionId));
		return null;
	}

	return row.account;
}

export async function destroySession(sessionId: string | undefined): Promise<void> {
	if (!sessionId) return;
	await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export function setSessionCookie(cookies: Cookies, sessionId: string): void {
	cookies.set(SESSION_COOKIE, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// Left off in dev so the cookie survives plain-HTTP localhost; the flow
		// bounces through plex.tv and back, and a Secure cookie would be dropped.
		secure: process.env.NODE_ENV === 'production',
		maxAge: SESSION_TTL_SECONDS
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
