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

### Direct API Access Pattern

All Plex API calls and images are fetched directly from the Plex server to minimize bandwidth usage:

- **Server Data**: `+layout.server.ts` exposes `plexToken` and `plexServerUrl` to client
- **API Usage**: `fetch(\`\${plexServerUrl}/library/sections?X-Plex-Token=\${plexToken}\`)`
- **Image Usage**: `<img src="{plexServerUrl}{thumbPath}?X-Plex-Token={token}" />`
- **Benefits**:
  - Eliminates all server-side proxy overhead
  - Drastically reduces Vercel bandwidth costs
  - Faster response times (no intermediate proxy)
  - Simpler architecture
- **Security**: Token is visible in URLs but protected by HTTPS in production
- **CORS**: Plex servers allow cross-origin requests when token is provided

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
│   ├── +layout.server.ts          # Server data (plexToken, plexServerUrl)
│   ├── +page.svelte              # Dashboard
│   ├── login/+page.svelte         # Login page
│   ├── logout/+server.ts          # Logout endpoint
│   ├── auth/callback/
│   │   ├── +page.svelte
│   │   └── +page.server.ts        # Auth callback handler
│   └── library/[id]/
│       ├── +page.svelte           # Library browser
│       ├── MovieRow.svelte        # Movie table row component
│       ├── ShowRow.svelte         # Show grid card component
│       ├── stats/+page.svelte     # Library statistics
│       └── show/[showId]/+page.svelte # Show details
├── components/
│   ├── Header.svelte              # Navigation header
│   └── VirtualList.svelte         # Virtual scrolling for large lists
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
- **Plex token exposure**: Token is exposed to client for direct API calls and images
- Token is only transmitted over HTTPS in production
- Cookies storing token/URL are HTTP-only, secure (in production), and SameSite strict
- Client ID is generated once and persisted in cookies
- This is a standard pattern for client-side Plex applications

### Performance
- Implement lazy loading for detailed metadata (only fetch when needed)
- Use percentile calculations cached per-filter to avoid recalculation
- Virtual scrolling for large movie libraries (VirtualList component)
- Direct API calls eliminate proxy latency

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
