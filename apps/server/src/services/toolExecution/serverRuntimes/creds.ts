import type { SandboxMode } from '@lobechat/builtin-tool-cloud-sandbox';
import { CredsIdentifier, type ICredsService } from '@lobechat/builtin-tool-creds';
import { CredsExecutionRuntime } from '@lobechat/builtin-tool-creds/executionRuntime';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import type { MarketService } from '@/server/services/market';
import {
  getSandboxProviderKind,
  MarketSandboxProvider,
  resolveSandboxSessionConfig,
  type SandboxProvider,
} from '@/server/services/sandbox';
import {
  mergeCredsEnvListing,
  resolveInjectedEnvVarsByKey,
} from '@/server/services/sandbox/credsEnv';

import { type ToolExecutionContext } from '../types';
import { resolveContentWorkspaceId } from './resolveWorkspaceScope';
import { createSandboxMarketService } from './sandboxMarket';
import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:creds-runtime');

/**
 * The sandbox the topic's tool calls run in, resolved the same way the
 * cloud-sandbox runtime resolves it. `instanceId` is the environment instance
 * (`SandboxSessionConfig.environment`).
 */
export interface CredsSandboxTarget {
  instanceId?: string;
  mode?: SandboxMode;
}

/**
 * Server-side Creds Service implementation
 * Wraps MarketService.market.creds to provide ICredsService interface
 */
export class ServerCredsService implements ICredsService {
  private marketService: MarketService;
  private workspaceId?: string;

  private isShareVisitor: boolean;
  private sandboxProvider?: Pick<SandboxProvider, 'callTool'>;

  private sandboxTarget: CredsSandboxTarget;

  constructor(
    marketService: MarketService,
    options: {
      /**
       * Belt-and-braces guard: true for an Agent Share visitor's run
       * (`context.agentShareVisitor` set). `lobe-creds` is already absent from
       * `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`, so this runtime should never
       * be constructed for a visitor in the first place — but `injectCreds`
       * refuses again here too, so the guarantee that the creator's decrypted
       * credentials never land in a sandbox a visitor controls doesn't rest on
       * the allowlist alone.
       */
      isShareVisitor?: boolean;
      /**
       * The Market sandbox the injection lands in. When set, `~/.creds/env` is
       * merged after each injection so earlier injections stay listed.
       */
      sandboxProvider?: Pick<SandboxProvider, 'callTool'>;
      /** Where the topic's tool calls run; injection must land in the same sandbox. */
      sandboxTarget?: CredsSandboxTarget;
      workspaceId?: string;
    } = {},
  ) {
    this.marketService = marketService;
    this.workspaceId = options.workspaceId;
    this.isShareVisitor = options.isShareVisitor ?? false;
    this.sandboxProvider = options.sandboxProvider;
    this.sandboxTarget = options.sandboxTarget ?? {};
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
    envVarsByKey?: Record<string, string[]>;
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
    //
    // Injection is often a topic's first sandbox call, so it creates the
    // session: without the mode and instance it lands on the throwaway
    // runtime, and the topic's first persistent tool call then replaces that
    // sandbox — discarding the credentials written here. Named one by one,
    // like `callTool`'s context, so a dropped SDK field fails the build.
    const result = await this.marketService.market.creds.inject({
      keys: params.keys,
      sandbox: params.sandbox,
      sandboxInstanceId: this.sandboxTarget.instanceId,
      sandboxMode: this.sandboxTarget.mode,
      topicId: params.topicId,
      userId: params.userId,
    });

    log('injectCreds success: notFound=%d', result.notFound?.length || 0);

    const envVarsByKey = await resolveInjectedEnvVarsByKey(params.keys, result, (key) =>
      this.marketService.market.creds.inject({
        keys: [key],
        sandbox: false,
        topicId: params.topicId,
        userId: params.userId,
      }),
    );

    if (params.sandbox !== false && this.sandboxProvider) {
      await mergeCredsEnvListing(this.sandboxProvider);
    }

    return { ...result, envVarsByKey } as any;
  }

  async listCreds(): Promise<{
    data?: Array<{ id: number; key: string }>;
  }> {
    log('listCreds');

    const result = await this.credsAccessor().list();

    log('listCreds success: %d credentials', result.data?.length || 0);

    return result as any;
  }
}

/**
 * Whether this run's commands can reach the cloud sandbox the credentials are
 * written into — the same formula as the `creds_sandbox_reachable` prompt
 * variable. A routed device runs `runCommand` / `execScript` on the device,
 * except in `auto`, where the dedicated Cloud Sandbox tool still reaches the
 * sandbox even though Skills' own `runCommand` goes to the device.
 */
const isCredsSandboxReachable = (
  context: Pick<ToolExecutionContext, 'activeDeviceId' | 'executionPlan'>,
): boolean => !context.activeDeviceId || context.executionPlan?.target === 'auto';

/**
 * Creds Server Runtime
 * Per-request runtime (needs userId, topicId)
 */
export const credsRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Creds execution');
    }

    // Recovered, not read off the context: the dispatch and resume paths drop
    // it, and credentials must be injected into the SAME sandbox session the
    // commands run in — the sandbox runtimes recover it the same way.
    const workspaceId = await resolveContentWorkspaceId(context);

    if (workspaceId) {
      if (!context.serverDB) {
        throw new Error('serverDB is required for workspace Creds execution');
      }

      const membership = await new WorkspaceMemberModel(context.serverDB, context.userId).getMember(
        workspaceId,
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
      workspaceId,
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

    // Credentials are injected INTO a sandbox, so this call has to agree with
    // the cloud-sandbox and skills runtimes about which one. A token without the
    // entitlement routes to the ephemeral runtime, and the injection lands in a
    // different sandbox than the commands that need it — or tears down the live
    // one on the way.
    const sandbox = await resolveSandboxSessionConfig({
      isShareVisitorRun: Boolean(context.agentShareVisitor),
      serverDB: context.serverDB,
      topicId: context.topicId,
      userId: context.userId,
      workspaceId,
    });

    const marketService = createSandboxMarketService(
      context,
      accessToken,
      workspaceId,
      sandbox.claim,
    );

    // Market's inject endpoint only writes into a Market sandbox, so the
    // listing merge runs there too, in the same session the commands use.
    const sandboxProvider =
      getSandboxProviderKind() === 'market' && context.topicId
        ? new MarketSandboxProvider({
            marketService,
            sandboxCwd: sandbox.cwd,
            sandboxInstanceId: sandbox.environment,
            sandboxMode: sandbox.mode,
            sandboxSpecification: sandbox.specification,
            sandboxWorkingDir: sandbox.workingDir,
            serverDB: context.serverDB,
            topicId: context.topicId,
            userId: context.userId,
          })
        : undefined;

    const credsService = new ServerCredsService(marketService, {
      isShareVisitor: Boolean(context.agentShareVisitor),
      sandboxProvider,
      sandboxTarget: { instanceId: sandbox.environment, mode: sandbox.mode },
      workspaceId,
    });

    return new CredsExecutionRuntime(credsService, {
      sandboxReachable: isCredsSandboxReachable(context),
      topicId: context.topicId,
      userId: context.userId,
    });
  },
  identifier: CredsIdentifier,
};
