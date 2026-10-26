import { getValidToken } from '../../../auth/refresh';
import { pickAuthSource } from '../../../auth/source';

/**
 * Whether this machine has never signed in to LobeHub: no credential in the
 * environment and no stored login. Such a user gets local reports. A login
 * that exists but no longer works is NOT signed out — they expect their
 * acceptance to publish, so the failure must surface instead.
 */
export const isSignedOut = async (): Promise<boolean> => {
  if (pickAuthSource().kind !== 'stored') return false;
  return (await getValidToken()).status === 'no-login';
};

export const LOCAL_MODE_INSTRUCTION =
  'Not signed in to LobeHub, so acceptance runs locally: write each round as usual and render it with `lh acceptance run render <roundDir>`; nothing is uploaded. No account language is set — write every human-readable acceptance field in the language the user converses in, and pass it to any subagent you delegate to. To share the acceptance for team review later, the user signs in and runs `lh acceptance publish <acceptanceDir>`.';
