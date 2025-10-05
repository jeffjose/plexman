# Plexman

A modern web application for managing and browsing Plex media libraries, built with SvelteKit 5.

## Features

- **Secure Authentication**: OAuth-based Plex authentication with automatic server discovery
- **Active Sessions**: Real-time monitoring of current playback with detailed codec/quality info
- **Library Browser**: Browse movies and TV shows with advanced filtering
- **Quality Analysis**: Percentile-based quality filtering (bitrate/filesize)
- **Smart Search**: Filter by title, quality tier, multi-file detection
- **Statistics**: Visual analytics for library quality distribution

## Quick Start

### Prerequisites

- Node.js 18+ (or compatible runtime)
- pnpm (recommended) or npm
- A Plex Media Server account

### Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Open http://localhost:5173
```

### Building for Production

```bash
# Create production build
pnpm run build

# Preview production build
pnpm run preview
```

## Usage

1. Navigate to the app and click "Login with Plex"
2. Authorize the application on Plex.tv
3. View your libraries, active sessions, and statistics
4. Use filters and search to find specific content

## Development

See [CLAUDE.md](./CLAUDE.md) for detailed development documentation, including:
- Architecture overview
- Authentication flow
- API patterns
- File structure
- Development workflow

### Available Scripts

```bash
pnpm run dev          # Start dev server
pnpm run build        # Build for production
pnpm run preview      # Preview production build
pnpm run check        # Type-check
pnpm run format       # Format code
pnpm run lint         # Lint check
```

## Tech Stack

- **SvelteKit 5** - Full-stack framework
- **TypeScript** - Type safety
- **Tailwind CSS 4** - Styling
- **Vite** - Build tool

## License

Private project

## Contributing

This is a personal project. For detailed development information, see [CLAUDE.md](./CLAUDE.md).
