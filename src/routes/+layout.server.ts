import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies }) => {
  const plexToken = cookies.get('plexToken');
  const plexServerUrlRemote = cookies.get('plexServerUrlRemote');

  // Only return these if user is authenticated
  if (plexToken && plexServerUrlRemote) {
    return {
      plexToken,
      plexServerUrl: plexServerUrlRemote
    };
  }

  return {
    plexToken: null,
    plexServerUrl: null
  };
};
