import { SignJWT } from 'jose';
import { ModelProvider } from 'model-bank';
import urlJoin from 'url-join';
import { z } from 'zod';

import { AiProviderModel } from '@/database/models/aiProvider';
import { NewApiAccountModel } from '@/database/models/newapiAccount';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

interface ProvisionUserParams {
  createdAt?: Date | null;
  email?: string | null;
  id: string;
  username?: string | null;
}

interface SsoUserParams {
  email?: string | null;
  id: string;
  username?: string | null;
}

const ProvisionResponseSchema = z.object({
  apiKey: z.string().min(1),
  userId: z.string().min(1),
});

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : JSON.stringify(error);

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export class NewApiAccountService {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  private get isConfigured() {
    return !!(
      appEnv.NEWAPI_ADMIN_TOKEN &&
      appEnv.NEWAPI_API_URL &&
      appEnv.NEWAPI_INTERNAL_URL &&
      appEnv.NEWAPI_SSO_SECRET &&
      appEnv.NEWAPI_WEB_URL
    );
  }

  async ensureProvisioned(user: ProvisionUserParams) {
    if (!this.isConfigured) return { reason: 'missing_config', skipped: true as const };

    const accountModel = new NewApiAccountModel(this.db, user.id);
    const existing = await accountModel.find();
    if (existing?.status === 'active' && existing.newapiUserId) {
      return { account: existing, skipped: false as const };
    }

    await accountModel.markPending();

    try {
      const response = await fetch(
        urlJoin(appEnv.NEWAPI_INTERNAL_URL!, appEnv.NEWAPI_PROVISION_PATH!),
        {
          body: JSON.stringify({
            createdAt: user.createdAt?.toISOString(),
            email: user.email,
            externalUserId: user.id,
            username: user.username,
          }),
          headers: {
            'Authorization': `Bearer ${appEnv.NEWAPI_ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      );

      if (!response.ok) {
        throw new Error(
          `NewAPI provision failed with ${response.status}: ${await response.text()}`,
        );
      }

      const result = ProvisionResponseSchema.parse(await response.json());

      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      await new AiProviderModel(this.db, user.id).updateConfig(
        ModelProvider.NewAPI,
        {
          config: { enableResponseApi: true },
          fetchOnClient: false,
          keyVaults: {
            apiKey: result.apiKey,
            baseURL: appEnv.NEWAPI_API_URL,
          },
        },
        gateKeeper.encrypt,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );

      await accountModel.markActive(result.userId);

      return { account: await accountModel.find(), skipped: false as const };
    } catch (error) {
      const message = errorMessage(error);
      await accountModel.markFailed(message);
      throw error;
    }
  }

  async createSsoRedirectUrl(user: SsoUserParams) {
    if (!this.isConfigured) throw new Error('NewAPI SSO is not configured');

    const account = await this.ensureProvisioned(user);
    const newapiUserId = account.account?.newapiUserId;
    if (!newapiUserId) throw new Error('NewAPI account is not provisioned');

    const secret = new TextEncoder().encode(appEnv.NEWAPI_SSO_SECRET);
    const redirectPath = appEnv.NEWAPI_ACCOUNT_PATH || '/console';
    const token = await new SignJWT({
      email: user.email ?? undefined,
      externalUserId: user.id,
      newapiUserId,
      redirectPath,
      username: user.username ?? undefined,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('lobehub')
      .setAudience('newapi')
      .setSubject(user.id)
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${appEnv.NEWAPI_SSO_TOKEN_TTL_SECONDS}s`)
      .sign(secret);

    const url = new URL(
      urlJoin(trimTrailingSlash(appEnv.NEWAPI_WEB_URL!), appEnv.NEWAPI_SSO_PATH!),
    );
    url.searchParams.set('token', token);
    url.searchParams.set('redirect', redirectPath);

    return url.toString();
  }
}
