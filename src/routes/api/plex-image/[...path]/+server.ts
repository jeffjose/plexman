import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment'; // Import dev flag

// Cache duration for images (e.g., 1 day)
const IMAGE_CACHE_SECONDS = 60 * 60 * 24;

// Generic handler for all GET requests to /api/plex-image/*
export const GET: RequestHandler = async ({ cookies, fetch, params, url, request }) => {
  // Log as soon as the request hits the server handler
  console.log(`Image Proxy: Received request for path: /${params.path}?${url.searchParams.toString()}`);

  const plexToken = cookies.get('plexToken');
  const plexServerUrlRemote = cookies.get('plexServerUrlRemote');
  const plexServerUrlLocal = cookies.get('plexServerUrlLocal');

  if (!plexToken || !plexServerUrlRemote || !plexServerUrlLocal) {
    console.error('Image Proxy: Missing plexToken or server URL cookies');
    throw error(401, 'Authentication required to load images.');
  }

  // Choose the appropriate URL based on the $app/environment `dev` flag
  const isLocal = dev; // Use the dev flag as the primary indicator
  const plexServerUrl = isLocal ? plexServerUrlLocal : plexServerUrlRemote;

  // Reconstruct the Plex image path. Path likely includes things like /library/metadata/X/thumb/timestamp
  const plexImagePath = `/${params.path}`; // Captures everything after /api/plex-image/
  const targetUrl = new URL(plexServerUrl + plexImagePath);

  // Forward necessary query parameters (like X-Plex-Token, though we add it header anyway)
  targetUrl.search = url.search; // Keep original query params if any, like timestamp
  // Ensure token is in query if needed by specific image endpoint (though header is preferred)
  // targetUrl.searchParams.set('X-Plex-Token', plexToken);

  console.log(`Image Proxy: Forwarding request to: ${targetUrl.toString()}`);

  const headers = {
    // We don't set Accept: application/json here, let Plex decide content type
    'X-Plex-Token': plexToken,
    'X-Plex-Client-Identifier': cookies.get('plexClientId') || 'PlexmanProxy' // Add Client ID
  };

  try {
    const response = await fetch(targetUrl.toString(), { headers });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Image Proxy: Error from Plex server (${targetUrl.toString()}). Status: ${response.status}, Body: ${errorBody}`
      );
      // Return the error status, don't try to return image data
      throw error(response.status, `Plex Image Error: ${response.statusText} (Path: ${plexImagePath})`);
    }

    // Get the raw image data as an ArrayBuffer
    const imageBuffer = await response.arrayBuffer();
    // Get the content type from the original Plex response
    const contentType = response.headers.get('content-type') || 'image/jpeg'; // Default if missing

    // Return the image data with caching headers
    return new Response(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${IMAGE_CACHE_SECONDS}, s-maxage=${IMAGE_CACHE_SECONDS}`,
        'Access-Control-Allow-Origin': '*' // Adjust if needed
      }
    });

  } catch (err: any) {
    console.error(`Image Proxy: Failed to fetch from Plex (${targetUrl.toString()}). Error:`, err);
    if (err.status) { // If it's an error thrown by SvelteKit's error()
      throw err;
    }
    throw error(502, `Failed to contact Plex server for image: ${err.message}`);
  }
}; 
