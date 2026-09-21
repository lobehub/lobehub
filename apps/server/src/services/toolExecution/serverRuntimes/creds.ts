import { CredsIdentifier, type ICredsService } from '@lobechat/builtin-tool-creds';
import { CredsExecutionRuntime } from '@lobechat/builtin-tool-creds/executionRuntime';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { MarketService } from '@/server/services/market';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:creds-runtime');

/**
 * Server-side Creds Service implementation
 * Wraps MarketService.market.creds to provide ICredsService interface
 */
export class ServerCredsService implements ICredsService {
  private marketService: MarketService;
  private workspaceId?: string;

  private isShareVisitor: boolean;

  constructor(
    marketService: MarketService,
    workspaceId?: string,
    /**
     * Belt-and-braces guard: true for an Agent Share visitor's run
     * (`context.agentShareVisitor` set). `lobe-creds` is already absent from
     * `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`, so this runtime should never
     * be constructed for a visitor in the first place — but `injectCreds`
     * refuses again here too, so the guarantee that the creator's decrypted
     * credentials never land in a sandbox a visitor controls doesn't rest on
     * the allowlist alone.
     */
    isShareVisitor = false,
  ) {
    this.marketService = marketService;
    this.workspaceId = workspaceId;
    this.isShareVisitor = isShareVisitor;
  }

  /**
   * Inside a workspace, reads/writes must hit the workspace's shared organization
   * credentials, never the operator's personal creds. Falls back to
   * the personal `market.creds` namespace outside a workspace.
   */
  private credsAccessor() {
    return this.workspaceId
      ? this.marketService.market.organizations.creds({ workspaceId: this.workspaceId })
      : this.marketService.market.creds;
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
    const listResult = await this.credsAccessor().list();
    const cred = listResult.data?.find((c) => c.key === key);

    if (!cred) {
      throw new Error(`Credential not found: ${key}`);
    }

    // Then get the full credential with optional decryption
    const result = await this.credsAccessor().get(cred.id, {
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

    // Refuse before the Market call, not after: Market's inject endpoint
    // writes the creator's REAL credentials into the sandbox's ~/.creds/env
    // server-side as part of handling the request (see the comment below),
    // so for a share visitor the only safe place to stop is here.
    if (this.isShareVisitor) {
      throw new Error(
        'Credential injection into the sandbox is unavailable in shared conversations.',
      );
    }

    // Market's generic inject endpoint resolves organization credentials from
    // the workspaceId signed into this service's trusted-client token, and —
    // when `sandbox` is true (the default) — already writes the *real*
    // (unmasked) values into the sandbox's ~/.creds/env server-side before
    // responding. The `credentials.env` map in that response is masked for
    // safe display to the model, so it must never be written into the
    // sandbox again here: an earlier version of this method did exactly
    // that, appending a masked `export` line after market's real one. Since
    // re-sourcing ~/.creds/env applies `export`s in file order, the masked
    // line silently shadowed the real credential for every later command.
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

    const result = await this.credsAccessor().list();

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

    const result = await this.credsAccessor().createKV(params);

    log('saveKVCred success: id=%d', result.id);

    return result;
  }
}

/**
 * Creds Server Runtime
 * Per-request runtime (needs userId, topicId)
 */
export const credsRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Creds execution');
    }

    if (context.workspaceId) {
      if (!context.serverDB) {
        throw new Error('serverDB is required for workspace Creds execution');
      }

      const membership = await new WorkspaceMemberModel(context.serverDB, context.userId).getMember(
        context.workspaceId,
        context.userId,
      );
      if (!membership) {
        throw new Error('Workspace membership is required for workspace Creds execution');
      }
    }

    log(
      'Creating CredsExecutionRuntime for userId=%s, topicId=%s, workspaceId=%s',
      context.userId,
      context.topicId,
      context.workspaceId,
    );

    // Read market accessToken from DB so server-side creds runtime can authenticate.
    let accessToken: string | undefined;
    if (context.serverDB) {
      try {
        const userModel = new UserModel(context.serverDB, context.userId);
        const settings = await userModel.getUserSettings();
        accessToken = (settings?.market as any)?.accessToken;
      } catch {
        // non-fatal — MarketService will fall back to trustedClientToken
      }
    }

    const marketService = new MarketService({
      accessToken,
      userInfo: { userId: context.userId, workspaceId: context.workspaceId },
    });

    const credsService = new ServerCredsService(
      marketService,
      context.workspaceId,
      Boolean(context.agentShareVisitor),
    );

    return new CredsExecutionRuntime(credsService, {
      topicId: context.topicId,
      userId: context.userId,
    });
  },
  identifier: CredsIdentifier,
};
