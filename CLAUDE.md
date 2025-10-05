# Plexman - Development Guide

## Project Overview

Plexman is a modern web application for managing and browsing Plex media libraries. Built with SvelteKit 5, it provides a responsive interface for viewing libraries, tracking active sessions, and analyzing media quality.

## Tech Stack

- **Framework**: SvelteKit 5 (Svelte 5.0)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4.0
- **Build Tool**: Vite 6.2.5
- **Package Manager**: pnpm (recommended)

## Architecture

### Authentication Flow

1. User initiates login via `/login`
2. App creates a Plex PIN and stores `plexPinId` + `plexClientId` in cookies
3. User is redirected to Plex.tv for authorization
4. Plex redirects back to `/auth/callback`
5. Server validates PIN, retrieves auth token, and fetches server resources
6. Stores three secure HTTP-only cookies:
   - `plexToken`: Authentication token
   - `plexServerUrlRemote`: HTTPS URL for remote access (plex.direct preferred)
   - `plexServerUrlLocal`: HTTP URL for local network access
7. Redirects to home page

### API Proxy Pattern

All Plex API calls route through SvelteKit server endpoints to keep tokens secure:

- **Route**: `/api/plex/[...path]/+server.ts`
- **Purpose**: Proxies requests to Plex server with authentication
- **Environment-aware**: Uses `plexServerUrlLocal` in dev, `plexServerUrlRemote` in production
- **Caching**: Smart cache durations based on endpoint type
  - Libraries: 10 minutes
  - Library contents: 30 minutes
  - Active sessions: no cache
  - Metadata: 2 hours

### Image Proxy

- **Route**: `/api/plex-image/[...path]/+server.ts`
- **Purpose**: Proxies Plex thumbnail/poster images with authentication
- **Usage**: `<img src="/api/plex-image{thumbPath}" />`

## Key Features

### 1. Dashboard (`/`)
- Displays active playback sessions with live updates (10s polling)
- Shows session details: user, device, progress, quality
- Color-coded progress bars:
  - Green: Direct play
  - Orange: Transcoding

### 2. Library Browser (`/library/[id]`)
- Lists all media items in a library
- **Movies**: Table view with sortable columns
- **TV Shows**: Grid view with poster cards
- Features:
  - Search by title
  - Quality filtering (percentile-based: 90p, 75p, 50p, 25p, <25p)
  - Multi-file detection
  - Sort by: Added date, Release date, Title, Size, Bitrate
  - Lazy-loaded detailed metadata

### 3. Statistics (`/library/[id]/stats`)
- Visual analytics for library quality distribution
- Bitrate percentile analysis

### 4. Show Details (`/library/[id]/show/[showId]`)
- Episode listing for TV shows
- Season-by-season breakdown

## Development Patterns

### State Management
Uses Svelte 5 stores extensively:
- `writable()` for mutable state
- `derived()` for computed values
- URL search params synced with filter state

### TypeScript Interfaces
Key types defined inline in components:
- `PlexItem`: Media item structure
- `Session`: Active playback session
- `MediaItem`, `MediaPart`, `Stream`: Nested media metadata

### Responsive Design
- Mobile-first Tailwind classes
- Grid layouts for shows: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8`
- Table layouts for movies with sticky headers

### Error Handling
- Centralized error stores
- 401 errors trigger redirect to `/login`
- User-friendly error messages displayed in UI

## File Structure

```
src/
├── routes/
│   ├── +page.svelte              # Dashboard
│   ├── login/+page.svelte         # Login page
│   ├── logout/+server.ts          # Logout endpoint
│   ├── auth/callback/
│   │   ├── +page.svelte
│   │   └── +page.server.ts        # Auth callback handler
│   ├── api/
│   │   ├── plex/[...path]/+server.ts       # Main API proxy
│   │   └── plex-image/[...path]/+server.ts # Image proxy
│   └── library/[id]/
│       ├── +page.svelte           # Library browser
│       ├── MovieRow.svelte        # Movie table row component
│       ├── ShowRow.svelte         # Show grid card component
│       ├── stats/+page.svelte     # Library statistics
│       └── show/[showId]/+page.svelte # Show details
├── components/
│   └── Header.svelte              # Navigation header
└── app.html                       # HTML template
```

## Development Workflow

### Setup
```bash
pnpm install
pnpm run dev
```

### Build
```bash
pnpm run build
pnpm run preview
```

### Code Quality
```bash
pnpm run check          # TypeScript + Svelte check
pnpm run format         # Format with Prettier
pnpm run lint           # Lint check
```

## Important Notes

### Security
- **Never expose Plex tokens to client**: All API calls use server-side proxy
- Cookies are HTTP-only, secure (in production), and SameSite strict
- Client ID is generated once and persisted in cookies

### Performance
- Implement lazy loading for detailed metadata (only fetch when needed)
- Use percentile calculations cached per-filter to avoid recalculation
- Smart caching strategy in API proxy reduces Plex server load

### Plex API Endpoints Used
- `GET /api/v2/pins` - Create auth PIN
- `GET /api/v2/pins/{id}` - Check PIN status
- `GET /api/v2/resources` - Get server list
- `GET /library/sections` - Get all libraries
- `GET /library/sections/{id}/all` - Get library contents
- `GET /library/metadata/{id}` - Get item metadata
- `GET /library/metadata/{id}/allLeaves` - Get show episodes
- `GET /status/sessions` - Get active sessions

## Environment Detection

The app automatically selects the appropriate Plex server URL:
- **Development** (`npm run dev`): Uses local HTTP URL
- **Production** (`npm run build`): Uses remote HTTPS URL

This is controlled by SvelteKit's `dev` flag from `$app/environment`.

## Future Considerations

- Add WebSocket support for real-time session updates
- Implement batch operations (delete, update metadata)
- Add user management features
- Support for multiple Plex servers
- Enhanced statistics and reporting
- Playlist management
