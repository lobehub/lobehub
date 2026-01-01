import { enableBetterAuth, enableClerk, enableNextAuth } from '@/const/auth';

import type { TrustedClientUserInfo } from './index';

/**
 * Get user info from the current session for trusted client authentication
 * This works with different authentication providers (Clerk, BetterAuth, NextAuth)
 *
 * @returns User info or undefined if not authenticated
 */
export const getSessionUser = async (): Promise<TrustedClientUserInfo | undefined> => {
  try {
    if (enableClerk) {
      const { currentUser } = await import('@clerk/nextjs/server');
      const user = await currentUser();

      if (!user?.id || !user?.primaryEmailAddress?.emailAddress) {
        return undefined;
      }

      return {
        email: user.primaryEmailAddress.emailAddress,
        name: user.fullName || user.firstName || undefined,
        userId: user.id,
      };
    }

    if (enableBetterAuth) {
      const { headers } = await import('next/headers');
      const { auth } = await import('@/auth');
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
    }

    if (enableNextAuth) {
      const { default: NextAuth } = await import('@/libs/next-auth');
      const session = await NextAuth.auth();

      if (!session?.user?.id || !session?.user?.email) {
        return undefined;
      }

      return {
        email: session.user.email,
        name: session.user.name || undefined,
        userId: session.user.id,
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
};
