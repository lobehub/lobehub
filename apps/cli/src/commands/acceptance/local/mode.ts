import { existsSync } from 'node:fs';

import { credentialsPath, pickAuthSource } from '../../../auth/source';

/**
 * Whether this machine has no credential in the environment and no stored
 * login file. Such a user gets local reports. A login
 * that exists but no longer works is NOT signed out — they expect their
 * acceptance to publish, so the failure must surface instead.
 */
export const isSignedOut = (): boolean => {
  if (pickAuthSource().kind !== 'stored') return false;
  // Token lookup also reports `no-login` for expired credentials without a
  // refresh token, and unreadable files cannot be distinguished by loading.
  // Leave validation and refresh to the authenticated path, not mode selection.
  return !existsSync(credentialsPath());
};

export const LOCAL_MODE_INSTRUCTION =
  'Not signed in to LobeHub, so acceptance runs locally: write each round as usual and render it with `lh acceptance run render <roundDir>`; nothing is uploaded. No account language is set — write every human-readable acceptance field in the language the user converses in, and pass it to any subagent you delegate to. To share the acceptance for team review later, the user signs in and runs `lh acceptance publish <acceptanceDir>`.';
