import type { WechatRawMessage } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

import { getMessengerWechatConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import type { DecryptedMessengerAccountLink } from '@/database/models/messengerAccountLink';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type { InstallationCredentials, MessengerInstallationStore } from './types';

const log = debug('lobe-server:messenger:install-store:wechat');
const CONTEXT_TOKEN_TTL_SECONDS = 24 * 60 * 60;

interface WechatCredentialsBlob {
  baseUrl?: string;
  botId?: string;
  botToken?: string;
}

export const wechatInstallationKey = (tenantId: string): string => `wechat:${tenantId}`;

const parseInstallationKey = (key: string): string | null => {
  if (!key.startsWith('wechat:')) return null;
  const tenantId = key.slice('wechat:'.length);
  return tenantId || null;
};

const toCredentials = (row: DecryptedMessengerAccountLink): InstallationCredentials | null => {
  const blob = row.credentials as WechatCredentialsBlob;
  if (!row.applicationId || !blob.botToken) {
    log('toCredentials: account link %s has incomplete credentials', row.id);
    return null;
  }

  return {
    applicationId: row.applicationId,
    baseUrl: blob.baseUrl,
    botId: blob.botId,
    botToken: blob.botToken,
    installationKey: wechatInstallationKey(row.tenantId),
    metadata: {},
    platform: 'wechat',
    tenantId: row.tenantId,
  };
};

const parsePayload = (rawBody: string): WechatRawMessage | null => {
  try {
    const payload = JSON.parse(rawBody) as Partial<WechatRawMessage>;
    if (!payload.from_user_id || !payload.to_user_id) return null;
    return payload as WechatRawMessage;
  } catch {
    return null;
  }
};

/**
 * Resolve per-user WeChat iLink credentials. The tenant id is the WeChat
 * sender id and the application id is the scanned iLink bot id, which makes
 * unknown senders fail closed before the shared messenger router can route
 * an Agent run.
 */
export class WechatInstallationStore implements MessengerInstallationStore {
  private gateKeeperPromise?: Promise<KeyVaultsGateKeeper>;

  async resolveByPayload(_req: Request, rawBody: string): Promise<InstallationCredentials | null> {
    const payload = parsePayload(rawBody);
    if (!payload) return null;

    const credentials = await this.lookup(payload.from_user_id, payload.to_user_id);
    if (!credentials) return null;

    if (payload.context_token) {
      const redis = getAgentRuntimeRedisClient();
      if (redis) {
        const key = `wechat:ctx-token:${credentials.applicationId}:${payload.from_user_id}`;
        await redis.set(key, payload.context_token, 'EX', CONTEXT_TOKEN_TTL_SECONDS);
      }
    }

    return credentials;
  }

  async resolveByKey(key: string): Promise<InstallationCredentials | null> {
    const tenantId = parseInstallationKey(key);
    if (!tenantId) return null;
    return this.lookup(tenantId);
  }

  private async lookup(
    tenantId: string,
    applicationId?: string,
  ): Promise<InstallationCredentials | null> {
    if (!(await getMessengerWechatConfig())) return null;
    const serverDB = await getServerDB();
    const row = await MessengerAccountLinkModel.findByPlatformUserWithCredentials(
      serverDB,
      {
        applicationId,
        platform: 'wechat',
        platformUserId: tenantId,
        tenantId,
      },
      await this.getGateKeeper(),
    );
    return row ? toCredentials(row) : null;
  }

  private getGateKeeper(): Promise<KeyVaultsGateKeeper> {
    if (!this.gateKeeperPromise) {
      this.gateKeeperPromise = KeyVaultsGateKeeper.initWithEnvKey();
    }
    return this.gateKeeperPromise;
  }
}
