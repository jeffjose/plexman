import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment'; // Import dev flag

// Fallback cache duration in seconds (e.g., 1 hour)
const DEFAULT_CACHE_SECONDS = 3600;

// Simple endpoint-specific cache durations (can be expanded)
const CACHE_DURATIONS: Record<string, number> = {
  '/library/sections': 60 * 10, // Cache libraries for 10 mins
  '/library/metadata/': 60 * 60 * 2, // Cache specific item metadata for 2 hours
  // Add more specific paths as needed
};

function getCacheDuration(path: string): number {
  for (const prefix in CACHE_DURATIONS) {
    if (path.startsWith(prefix)) {
      return CACHE_DURATIONS[prefix];
    }
  }
  // More dynamic paths like /library/sections/X/all
  if (/^\/library\/sections\/\d+\/all/.test(path)) {
    return 60 * 30; // Cache library contents for 30 mins
  }
  if (/^\/library\/metadata\/\d+\/allLeaves/.test(path)) {
    return 60 * 30; // Cache show episodes for 30 mins
  }
  if (path === '/status/sessions') {
    return 0; // Don't cache active sessions
  }
  return DEFAULT_CACHE_SECONDS;
}

// Generic handler for all GET requests to /api/plex/*
export const GET: RequestHandler = async ({ cookies, fetch, params, url, request }) => {
  // Log as soon as the request hits the server handler
  console.log(`API Proxy: Received request for path: /${params.path}?${url.searchParams.toString()}`);

  const plexToken = cookies.get('plexToken');
  const plexServerUrlRemote = cookies.get('plexServerUrlRemote');
  const plexServerUrlLocal = cookies.get('plexServerUrlLocal');

  if (!plexToken || !plexServerUrlRemote || !plexServerUrlLocal) {
    console.error('API Proxy: Missing plexToken or server URL cookies');
    throw error(401, 'Authentication required. Please login again.');
  }

  // Choose the appropriate URL based on the $app/environment `dev` flag
  const isLocal = dev;
  const plexServerUrl = isLocal ? plexServerUrlLocal : plexServerUrlRemote;

  // Reconstruct the Plex API path from the SvelteKit params
  const plexApiPath = `/${params.path}`;
  const targetUrl = new URL(plexServerUrl + plexApiPath);

  // Forward query parameters from the original request
  targetUrl.search = url.search;

  const headers = {
    Accept: 'application/json',
    'X-Plex-Token': plexToken,
    // Add other necessary Plex headers if needed (like X-Plex-Client-Identifier, etc.)
    // 'X-Plex-Client-Identifier': cookies.get('plexClientId') || 'PlexmanProxy',
    'X-Plex-Product': 'Plexman',
    'X-Plex-Version': '1.0.0',
    'X-Plex-Platform': 'Web',
    'X-Plex-Platform-Version': '1.0.0',
    'X-Plex-Device': 'Proxy', // Identify as the proxy
    'X-Plex-Device-Name': 'Plexman Server Proxy'
  };

  try {
    const response = await fetch(targetUrl.toString(), { headers });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `API Proxy: Error from Plex server (${targetUrl.toString()}). Status: ${response.status}, Body: ${errorBody}`
      );
      // Forward the error status and a sanitized message
      throw error(response.status, `Plex API Error: ${response.statusText} (Path: ${plexApiPath})`);
    }

    const data = await response.json();

    // Determine cache duration based on the requested path
    const cacheSeconds = getCacheDuration(plexApiPath);

    // Return the data from Plex, adding cache headers
    return json(data, {
      headers: {
        'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}` : 'no-cache, no-store',
        // Add other headers if needed, e.g., CORS
        'Access-Control-Allow-Origin': '*' // Adjust if needed for specific origins
      }
    });

  } catch (err: any) {
    console.error(`API Proxy: Failed to fetch from Plex (${targetUrl.toString()}). Error:`, err);
    // Handle potential network errors or thrown errors
    if (err.status) { // If it's an error thrown by SvelteKit's error()
      throw err;
    }
    throw error(502, `Failed to contact Plex server: ${err.message}`);
  }
};

// We likely only need GET for Plex API browsing, but stubs for others can be added if needed.
// export const POST: RequestHandler = async ({ request }) => { ... };
// export const PUT: RequestHandler = async ({ request }) => { ... };
// export const DELETE: RequestHandler = async ({ request }) => { ... }; 
