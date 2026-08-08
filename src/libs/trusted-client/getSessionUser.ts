import { headers } from 'next/headers';

import { type TrustedClientUserInfo } from './index';

/**
 * Get user info from the current session for trusted client authentication
 *
 * @returns User info or undefined if not authenticated
 */
export const getSessionUser = async (): Promise<TrustedClientUserInfo | undefined> => {
  try {
    // Dynamic import to avoid validator ESM/CJS issue during sitemap generation
    const { auth } = await import('@/auth');
    const headersList = await headers();
    // AUTH-002: skip cookie cache so logout / password-reset revoke is honored immediately
    const session = await auth.api.getSession({
      headers: headersList,
      query: { disableCookieCache: true },
    });

    if (!session?.user?.id || !session?.user?.email) {
      return undefined;
    }

    return {
      email: session.user.email,
      name: session.user.name || undefined,
      userId: session.user.id,
    };
  } catch {
    return undefined;
  }
};
