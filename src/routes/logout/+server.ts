import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  // Clear the authentication cookies
  cookies.delete('plexToken', { path: '/' });
  cookies.delete('plexServerUrlRemote', { path: '/' });
  cookies.delete('plexServerUrlLocal', { path: '/' });
  // Optionally clear client ID too, if not needed elsewhere
  // cookies.delete('plexClientId', { path: '/' });

  console.log('Logout Server: Cleared auth cookies.');

  // Redirect to the login page
  throw redirect(303, '/login');
};

// Optional: Add a GET handler if you want to allow logging out via link (less standard for actions)
// export const GET: RequestHandler = async ({ cookies }) => {
// 	cookies.delete('plexToken', { path: '/' });
// 	cookies.delete('plexServerUrl', { path: '/' });
// 	throw redirect(303, '/login');
// }; 
