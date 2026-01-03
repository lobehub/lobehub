import { buildTrustedClientPayload, createTrustedClientToken } from '@lobehub/market-sdk';

import { appEnv } from '@/envs/app';

export interface TrustedClientUserInfo {
  email: string;
  name?: string;
  userId: string;
}

export { getSessionUser } from './getSessionUser';

/**
 * Check if trusted client authentication is enabled
 */
export const isTrustedClientEnabled = (): boolean => {
  return !!(appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID);
};

/**
 * Generate trusted client token for a specific user
 * This token includes encrypted user info and is used for Market API authentication
 *
 * @param userInfo - User information (userId, email, name)
 * @returns Encrypted token string or undefined if not configured
 */
export const generateTrustedClientToken = (userInfo: TrustedClientUserInfo): string | undefined => {
  const { MARKET_TRUSTED_CLIENT_SECRET, MARKET_TRUSTED_CLIENT_ID } = appEnv;

  if (!MARKET_TRUSTED_CLIENT_SECRET || !MARKET_TRUSTED_CLIENT_ID) {
    return undefined;
  }

  if (!userInfo.email) {
    return undefined;
  }

  try {
    const payload = buildTrustedClientPayload({
      clientId: MARKET_TRUSTED_CLIENT_ID,
      email: userInfo.email,
      name: userInfo.name,
      userId: userInfo.userId,
    });

    return createTrustedClientToken(payload, MARKET_TRUSTED_CLIENT_SECRET);
  } catch (error) {
    console.error('Failed to generate trusted client token:', error);
    return undefined;
  }
};

/**
 * Get trusted client token for the current session user
 * This is a convenience function that combines getSessionUser and generateTrustedClientToken
 *
 * @returns Encrypted token string or undefined if not configured or user not authenticated
 */
export const getTrustedClientTokenForSession = async (): Promise<string | undefined> => {
  const { getSessionUser } = await import('./getSessionUser');
  const userInfo = await getSessionUser();

  if (!userInfo) {
    return undefined;
  }

  return generateTrustedClientToken(userInfo);
};
