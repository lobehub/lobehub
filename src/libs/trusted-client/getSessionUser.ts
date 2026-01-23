import { headers } from 'next/headers';

import { auth } from '@/auth';

import type { TrustedClientUserInfo } from './index';

/**
 * Get user info from the current session for trusted client authentication
 *
 * @returns User info or undefined if not authenticated
 */
export const getSessionUser = async (): Promise<TrustedClientUserInfo | undefined> => {
  try {
    const headersList = await headers();
    const session = await auth.api.getSession({
      headers: headersList,
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
