import { getDBInstance } from '@/database/core/web-server';
import { authEnv } from '@/envs/auth';
import { type OIDCProvider, createOIDCProvider } from '@/libs/oidc-provider/provider';

/**
 * OIDC Provider instance
 */
let provider: OIDCProvider;

/**
 * Get OIDC Provider instance
 * @returns OIDC Provider instance
 */
export const getOIDCProvider = async (): Promise<OIDCProvider> => {
  if (!provider) {
    if (!authEnv.ENABLE_OIDC) {
      throw new Error('OIDC is not enabled. Set ENABLE_OIDC=1 to enable it.');
    }

    const db = getDBInstance();
    provider = await createOIDCProvider(db);
  }

  return provider;
};
