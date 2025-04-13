import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// This runs server-side when the user is redirected back from Plex auth
export const load: PageServerLoad = async ({ cookies, fetch, url }) => {
  const pinId = cookies.get('plexPinId');
  const clientId = cookies.get('plexClientId');

  if (!pinId || !clientId) {
    console.error('Callback Server: Missing pinId or clientId cookie');
    // Clear potentially stale cookies just in case
    cookies.delete('plexPinId', { path: '/' });
    cookies.delete('plexClientId', { path: '/' });
    throw error(400, 'Missing authentication data. Please try logging in again.');
  }

  try {
    // 1. Check the PIN status to get the auth token
    console.log(`Callback Server: Checking PIN ${pinId} with client ${clientId}`);
    const pinCheckResponse = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
      headers: {
        Accept: 'application/json',
        'X-Plex-Client-Identifier': clientId
      }
    });

    if (!pinCheckResponse.ok) {
      const errorBody = await pinCheckResponse.text();
      console.error(`Callback Server: Failed to verify PIN ${pinId}. Status: ${pinCheckResponse.status}, Body: ${errorBody}`);
      throw new Error(`Failed to verify authentication with Plex (PIN check failed - status ${pinCheckResponse.status})`);
    }

    const pinData = await pinCheckResponse.json();
    // console.log('Callback Server: PIN check response:', pinData); // Might contain token, log cautiously

    // Allow for slight delay if token isn't immediately available
    if (!pinData.authToken) {
      console.warn('Callback Server: No authToken received yet, waiting 2s and retrying...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const retryResponse = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
        headers: { 'Accept': 'application/json', 'X-Plex-Client-Identifier': clientId }
      });
      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        if (retryData.authToken) {
          pinData.authToken = retryData.authToken;
        } else {
          console.error('Callback Server: No authToken received on retry.');
          throw new Error('No auth token received from Plex after retry. Please complete the login on Plex.tv.');
        }
      } else {
        throw new Error(`Failed to verify authentication with Plex (PIN check retry failed - status ${retryResponse.status})`);
      }
    }

    const plexToken = pinData.authToken;
    console.log('Callback Server: Auth token received.');

    // 2. Fetch server resources to get connection URL
    console.log('Callback Server: Fetching resources with new token...');
    const resourcesUrl = new URL('https://plex.tv/api/v2/resources');
    resourcesUrl.searchParams.set('includeHttps', '1');
    const resourceResponse = await fetch(resourcesUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': plexToken,
        'X-Plex-Client-Identifier': clientId // Use the same client ID
      }
    });

    if (!resourceResponse.ok) {
      throw new Error(`Failed to fetch Plex resources (status ${resourceResponse.status})`);
    }

    const resources = await resourceResponse.json();
    const server = resources.find((r: any) => r.provides === 'server');

    if (!server) {
      throw new Error('No Plex server found associated with your account.');
    }
    console.log('Callback Server: Raw Connections Received:', JSON.stringify(server.connections, null, 2)); // Log raw connections

    // 3. Select the appropriate remote HTTPS URL AND construct local HTTP URL for cookies
    const connections = server.connections || [];
    let plexServerUrlRemote: string | undefined = undefined;
    let plexServerUrlLocal: string | undefined = undefined;

    // Find best remote URL (HTTPS > plex.direct first)
    const remoteHttps = connections.filter((c: any) => c.protocol === 'https' && !c.local);
    plexServerUrlRemote = remoteHttps.find((c: any) => c.uri.includes('.plex.direct'))?.uri;
    if (!plexServerUrlRemote) {
      plexServerUrlRemote = remoteHttps[0]?.uri;
    }

    // Find best local connection data to *construct* HTTP URL (non-loopback preferred)
    const localConnections = connections.filter((c: any) => c.local);
    const preferredLocalData = localConnections.find((c: any) => !c.address.startsWith('127.'));
    const chosenLocalData = preferredLocalData || localConnections[0]; // Use first local if non-127 not found

    if (chosenLocalData) {
      // Construct the local URL using HTTP, address, and port, ignoring the protocol/URI in the response
      plexServerUrlLocal = `http://${chosenLocalData.address}:${chosenLocalData.port}`;
    } else {
      // If NO local connection data found at all, fallback to remote
      console.warn('Callback Server: No local connection data found. Using remote URL as local fallback.');
      plexServerUrlLocal = plexServerUrlRemote;
    }

    // Fallback logic if remote URL wasn't found (should be rare)
    if (!plexServerUrlRemote) {
      console.warn('Callback Server: No suitable remote HTTPS connection found. Using first available HTTPS or first overall.');
      plexServerUrlRemote = connections.find((c: any) => c.protocol === 'https')?.uri || connections[0]?.uri;
    }

    if (!plexServerUrlRemote || !plexServerUrlLocal) {
      console.error('Callback Server: Could not determine valid connection URLs.', connections);
      throw new Error('Could not find suitable connection URLs for your Plex server.');
    }

    console.log(`Callback Server: Selected Remote URL: ${plexServerUrlRemote}`);
    console.log(`Callback Server: Selected Local URL: ${plexServerUrlLocal}`);

    // 4. Store BOTH URLs in secure, HTTP-only cookies
    const cookieOptions = {
      path: '/' as const,
      httpOnly: true,
      secure: url.protocol === 'https:', // Use secure cookies if the callback itself is HTTPS
      sameSite: 'strict' as const,
      maxAge: 60 * 60 * 24 * 30 // 30 days
    };

    cookies.set('plexToken', plexToken, cookieOptions);
    cookies.set('plexServerUrlRemote', plexServerUrlRemote, cookieOptions);
    cookies.set('plexServerUrlLocal', plexServerUrlLocal, cookieOptions);
    console.log('Callback Server: Set plexToken, plexServerUrlRemote, and plexServerUrlLocal cookies.');

    // 5. Clean up temporary cookies
    cookies.delete('plexPinId', { path: '/' });
    console.log('Callback Server: Deleted plexPinId cookie.');

  } catch (err: any) {
    console.error('Callback Server: Error during authentication process:', err);
    // Clean up temporary cookies on error
    cookies.delete('plexPinId', { path: '/' });
    // Ensure main auth cookies are cleared if process failed midway
    cookies.delete('plexToken', { path: '/' });
    cookies.delete('plexServerUrlRemote', { path: '/' });
    cookies.delete('plexServerUrlLocal', { path: '/' });
    throw error(500, `Authentication failed: ${err.message || 'Unknown error'}`);
  }

  // 6. Redirect to the home page upon success
  console.log('Callback Server: Redirecting to /...');
  throw redirect(303, '/');
}; 
