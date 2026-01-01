import { getDBInstance } from '@/database/core/web-server';
import { oidcEnv } from '@/envs/oidc';
import { type OIDCProvider, createOIDCProvider } from '@/libs/oidc-provider/provider';

/**
 * OIDC Provider 实例
 */
let provider: OIDCProvider;

/**
 * 获取 OIDC Provider 实例
 * @returns OIDC Provider 实例
 */
export const getOIDCProvider = async (): Promise<OIDCProvider> => {
  if (!provider) {
    if (!oidcEnv.ENABLE_OIDC) {
      throw new Error('OIDC is not enabled. Set ENABLE_OIDC=1 to enable it.');
    }

    const db = getDBInstance();
    provider = await createOIDCProvider(db);
  }

  return provider;
};
