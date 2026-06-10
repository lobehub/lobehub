import {
  CredsExecutionRuntime,
  CredsIdentifier,
  type ICredsService,
} from '@lobechat/builtin-tool-creds';
import debug from 'debug';

import { MarketService } from '@/server/services/market';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:creds-runtime');

/**
 * Server-side Creds Service implementation
 * Wraps MarketService.market.creds to provide ICredsService interface
 */
class ServerCredsService implements ICredsService {
  private marketService: MarketService;

  constructor(marketService: MarketService) {
    this.marketService = marketService;
  }

  async getByKey(
    key: string,
    options?: { decrypt?: boolean },
  ): Promise<{
    fileName?: string;
    fileUrl?: string;
    name?: string;
    plaintext?: Record<string, string>;
    type: string;
    values?: Record<string, string>;
  }> {
    log('getByKey: key=%s, decrypt=%s', key, options?.decrypt);

    // First find the credential by key from the list
    const listResult = await this.marketService.market.creds.list();
    const cred = listResult.data?.find((c) => c.key === key);

    if (!cred) {
      throw new Error(`Credential not found: ${key}`);
    }

    // Then get the full credential with optional decryption
    const result = await this.marketService.market.creds.get(cred.id, {
      decrypt: options?.decrypt,
    });

    log('getByKey success: key=%s, id=%d', key, cred.id);

    return result as any;
  }

  async getOAuthAuthorizeUrl(
    provider: string,
    redirectUri: string,
  ): Promise<{
    authorizeUrl: string;
  }> {
    log('getOAuthAuthorizeUrl: provider=%s', provider);

    const response = await this.marketService.market.connect.authorize(provider, {
      redirect_uri: redirectUri,
    });

    return {
      authorizeUrl: response.authorize_url,
    };
  }

  async getOAuthConnectionStatus(provider: string): Promise<{
    connected: boolean;
  }> {
    log('getOAuthConnectionStatus: provider=%s', provider);

    const response = await this.marketService.market.connect.getStatus(provider);

    return {
      connected: response.connected,
    };
  }

  async injectCreds(params: {
    keys: string[];
    sandbox?: boolean;
    topicId: string;
    userId: string;
  }): Promise<{
    credentials?: {
      env?: Record<string, string>;
      files?: Array<{ filename: string; key: string; path: string }>;
    };
    notFound?: string[];
    success: boolean;
    unsupportedInSandbox?: string[];
  }> {
    log('injectCreds: keys=%O, topicId=%s', params.keys, params.topicId);

    const result = await this.marketService.market.creds.inject({
      keys: params.keys,
      sandbox: params.sandbox,
      topicId: params.topicId,
      userId: params.userId,
    });

    log('injectCreds success: notFound=%d', result.notFound?.length || 0);

    return result as any;
  }

  async listCreds(): Promise<{
    data?: Array<{ id: number; key: string }>;
  }> {
    log('listCreds');

    const result = await this.marketService.market.creds.list();

    log('listCreds success: %d credentials', result.data?.length || 0);

    return result as any;
  }

  async saveKVCred(params: {
    description?: string;
    key: string;
    name: string;
    type: 'kv-env' | 'kv-header';
    values: Record<string, string>;
  }): Promise<{ id: number }> {
    log('saveKVCred: key=%s, name=%s, type=%s', params.key, params.name, params.type);

    const result = await this.marketService.market.creds.createKV(params);

    log('saveKVCred success: id=%d', result.id);

    return result;
  }
}

/**
 * Creds Server Runtime
 * Per-request runtime (needs userId, topicId)
 */
export const credsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Creds execution');
    }

    log(
      'Creating CredsExecutionRuntime for userId=%s, topicId=%s',
      context.userId,
      context.topicId,
    );

    const marketService = new MarketService({ userInfo: { userId: context.userId } });
    const credsService = new ServerCredsService(marketService);

    return new CredsExecutionRuntime(credsService, {
      topicId: context.topicId,
      userId: context.userId,
    });
  },
  identifier: CredsIdentifier,
};
