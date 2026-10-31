import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { isTrustedClientEnabled } from '@/libs/trusted-client';

import { getSandboxDeployment } from './deployment';

/**
 * Whether this user can run commands in the cloud sandbox: a configured
 * Onlyboxes console, or Market reachable through the trusted client or the
 * user's own Market authorization.
 */
export const isSandboxAvailableForUser = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<boolean> => {
  const deployment = getSandboxDeployment();
  if (deployment !== 'market') return deployment === 'onlyboxes';
  if (isTrustedClientEnabled()) return true;

  try {
    const settings = await new UserModel(db, userId).getUserSettings();
    return !!(settings?.market as { accessToken?: string } | undefined)?.accessToken;
  } catch {
    return false;
  }
};
