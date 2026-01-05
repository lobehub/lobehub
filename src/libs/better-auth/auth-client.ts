import {
  adminClient,
  genericOAuthClient,
  inferAdditionalFields,
  magicLinkClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import type { auth } from '@/auth';
import { getAuthConfig } from '@/envs/auth';

const { NEXT_PUBLIC_AUTH_URL } = getAuthConfig();

export const {
  linkSocial,
  accountInfo,
  listAccounts,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  signIn,
  signOut,
  signUp,
  unlinkAccount,
  useSession,
} = createAuthClient({
  /** The base URL of the server (optional if you're using the same domain) */
  ...(NEXT_PUBLIC_AUTH_URL
    ? {
        baseURL: NEXT_PUBLIC_AUTH_URL,
      }
    : {}),
  plugins: [
    adminClient(),
    inferAdditionalFields<typeof auth>(),
    genericOAuthClient(),
    // Always include magicLinkClient - server will reject if not enabled
    magicLinkClient(),
  ],
});
