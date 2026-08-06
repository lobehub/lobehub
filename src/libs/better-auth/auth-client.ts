import { CLIENT_VERSION_HEADER, CURRENT_VERSION } from '@lobechat/const';
import {
  adminClient,
  genericOAuthClient,
  inferAdditionalFields,
  magicLinkClient,
  phoneNumberClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { type auth } from '@/auth';

export const {
  changeEmail,
  getSession,
  linkSocial,
  oauth2,
  accountInfo,
  listAccounts,
  phoneNumber,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  signIn,
  signOut,
  signUp,
  unlinkAccount,
  useSession,
} = createAuthClient({
  fetchOptions: {
    headers: {
      [CLIENT_VERSION_HEADER]: CURRENT_VERSION,
    },
  },
  plugins: [
    adminClient(),
    inferAdditionalFields<typeof auth>(),
    genericOAuthClient(),
    phoneNumberClient(),
    // Always include magicLinkClient - server will reject if not enabled
    magicLinkClient(),
  ],
});
