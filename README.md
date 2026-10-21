# Plexman

A web app for looking at your Plex watch history — a GitHub-style calendar
heatmap over every day you've watched something, backed by a scrollable
timeline of what it actually was.

Sign in with your Plex account, sync, and the whole history lands in a local
SQLite file. Nothing leaves your machine.

## Stack

SvelteKit 2 · Svelte 5 (runes) · Tailwind v4 · shadcn-svelte · Drizzle + libSQL

## Running it

```sh
pnpm install
pnpm exec drizzle-kit push   # create the SQLite schema
pnpm dev
```

Then open the printed URL and hit **Sign in with Plex**.

`DATABASE_URL` in `.env` points at `file:local.db` by default — see
`.env.example`.

## How the pieces fit

### Signing in

Plex's OAuth is a PIN exchange, not a redirect grant:

1. `POST plex.tv/api/v2/pins` → `{ id, code }`
2. the browser goes to `app.plex.tv/auth#?clientID=…&code=…&forwardUrl=…`
3. you approve it on plex.tv and get sent back to `forwardUrl`
4. `GET plex.tv/api/v2/pins/:id` → `authToken`

The return trip carries no code or state of its own, so the pin id is stashed in
a short-lived cookie before the redirect (`src/routes/auth/plex/`). The client
identifier Plex ties the PIN to is generated once and kept in the `settings`
table — a new one per restart would orphan a device entry in your Plex account
every time.

### Getting the history

Watch history lives on the media server, not on plex.tv:
`/status/sessions/history/all`. Each server has its own access token and its own
list of candidate addresses (LAN, remote, relay), so `src/lib/server/plex/`
probes them best-first and caches whichever answered.

Sync (`src/lib/server/sync/history.ts`) is incremental: each server remembers
its newest `viewedAt` and asks only for entries after it, re-fetching the last
hour so a view landing on the watermark second can't be skipped. The first run
walks everything, which on a long-lived server can take a minute.

`POST /api/sync` runs it; `?full=1` ignores the watermark and re-walks
everything, which is what you want after Plex itself rewrites history (a library
move, a bulk mark-unwatched).

### Staying current

The full sync is not slow because a delta is expensive — measured against a real
server the incremental library pages come back in 8–39ms and are usually empty.
It's slow because it pays a fixed toll every run regardless: a plex.tv resources
call (~400ms), a roster fetch, a correlated UPDATE rebuilding per-user counts,
and up to 50 plex.tv show-metadata lookups (~10–25s). That's maintenance, and
maintenance doesn't belong on a timer.

So `POST /api/sync/light` (`src/lib/server/sync/light.ts`) does only what has to
happen often, and leans on signals Plex already gives us:

- **`/library/sections` reports `contentChangedAt`** — a counter, not a
  timestamp, that the server bumps on any add, edit or delete in a section.
  Stored per section, so the usual case is one request for the whole server that
  decides to walk nothing.
- **`/status/sessions` (15ms)** is the only view of a play *while it happens*;
  history isn't written until Plex scrobbles, around 90% through.
- History asks the same filtered question the full sync does, which is one
  request returning zero rows on a quiet server.

Steady state is ~400ms and reports `changed: false`, which is what stops the
browser re-running every query on the page. "Changed" is a row-count delta, not
the upsert's own tally: the one-hour overlap window re-touches recent rows on
every run, so trusting that tally would report a change forever.

It deliberately never does a *first* walk — a server or section with no prior
sync is reported as pending and left to the full sync, so opening the app can't
silently start a 52,000-item crawl from a background timer.

Two things drive it: the browser polls every 90s while the tab is visible
(`createActivityPoll` in `src/lib/sync.svelte.ts`), and the server itself every
10 minutes so nothing is lost when no browser is open at all
(`src/lib/server/sync/scheduler.ts`). They share an in-flight guard, since they
will overlap.

Plex also has a push channel — a WebSocket at `/:/websockets/notifications`, no
Plex Pass needed — that would replace the polling entirely and report deletions
as they happen. Not built yet.

Two things the sync has to defend against, both found against real servers:

- **Impossible timestamps.** Plex stores the timestamp the _playing client_
  reports, so a device with a broken clock writes it straight into history — a
  phone produced entries dated 1954. Anything before 2008 or more than a day in
  the future is rejected and counted, and the sync banner says how many. The
  view was real; only its timestamp is garbage, and one such row would otherwise
  stretch the heatmap across seven decades.
- **Shared servers are ignored.** Only servers you own are discovered and
  synced. `/accounts` is admin-only, so a friend's server answers 403 and would
  sit in the UI as a permanently-failing sync target for the sake of the few
  things you watched there. Anything you watched on someone else's server won't
  appear.

### Showing it

`viewedAt` is a UTC instant and the heatmap is a grid of _local_ days — the two
only agree if the conversion knows your IANA zone, which SQLite can't do. So day
bucketing happens in JS (`src/lib/server/queries/activity.ts`), using a zone the
browser reports via cookie.

Filters live in the URL, which is what the server load reads — a filtered view
is shareable and survives a reload. Clicking a heatmap cell scopes the timeline
to that day but deliberately leaves the calendar at full span.

Posters are proxied through `/api/image` rather than linked directly: the URLs
are on a server the browser often can't reach, and each needs a token that has
no business being in the DOM.

## What's not here yet

- Exporting history — the reason this exists. The local cache is the
  groundwork for feeding "what I've actually watched" into recommendations.
- Watch _time_ totals. History rows frequently omit `duration`, so summing them
  would silently undercount; that needs a metadata enrichment pass first.
- Reconciling deletions without a full walk. `?X-Plex-Container-Size=0` returns
  a section's `totalSize` in ~23ms, so a count mismatch would be a cheap trigger
  for re-walking just that section.
