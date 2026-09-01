import { CredsIdentifier, type ICredsService } from '@lobechat/builtin-tool-creds';
import { CredsExecutionRuntime } from '@lobechat/builtin-tool-creds/executionRuntime';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { MarketService } from '@/server/services/market';
import { createSandboxService, type SandboxService } from '@/server/services/sandbox';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:creds-runtime');

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** POSIX shell identifier — the only names `export NAME=...` can safely take. */
const VALID_ENV_NAME_PATTERN = /^[A-Z_]\w*$/i;

/**
 * Write injected env-style credentials into the sandbox at `~/.creds/env`,
 * matching the exact contract `packages/builtin-tool-creds/src/systemRole.ts`
 * documents to the model ("Environment-based credentials... Written to
 * `~/.creds/env` file"). Without this, `injectCreds` only fetched and
 * decrypted the values and returned them in the tool result — nothing ever
 * placed them in the sandbox, so the tool reported "injected successfully"
 * while `~/.creds/env` never existed and subsequent `runCommand` calls that
 * `source`d it found nothing.
 *
 * Appends rather than overwrites, since a topic can call `injectCredsToSandbox`
 * more than once across a session and earlier values should survive.
 *
 * Two layers of shell-safety, not one:
 * 1. Each written line is `export NAME=<single-quoted value>` — the quoting
 *    happens INSIDE the file content, so when the documented consumer later
 *    runs `source ~/.creds/env`, a value containing `$(...)`, backticks,
 *    `;`, or a newline is loaded as an inert literal, not executed. `export`
 *    (not a bare assignment) is required too — a bare `NAME=value` is a
 *    shell variable, invisible to any child process the sourcing shell
 *    spawns (a Python/Node subprocess, another binary, etc.), which is a
 *    silent-failure shape indistinguishable from "injection didn't happen".
 * 2. Each fully-built line is itself passed through `shellQuote` as a single
 *    `printf '%s\n' <line>` argument, so the runCommand call that WRITES the
 *    file can't be broken out of either — the value is opaque to the outer
 *    shell that's doing the writing.
 * Credential keys that aren't valid shell identifiers (seen in practice:
 * hyphenated keys like `TEST-WORKSPACE-CREDS-KV`) can't be made into a safe
 * `export NAME=...` at all — writing them raw could inject shell syntax
 * through the name position, which quoting the value alone can't stop. Skip
 * and report them rather than attempt it.
 */
export async function writeEnvCredsToSandbox(
  sandboxService: SandboxService,
  env: Record<string, string>,
): Promise<{ error?: string; skippedInvalidNames?: string[] }> {
  const entries = Object.entries(env);
  if (entries.length === 0) return {};

  const valid = entries.filter(([key]) => VALID_ENV_NAME_PATTERN.test(key));
  const skippedInvalidNames = entries
    .filter(([key]) => !VALID_ENV_NAME_PATTERN.test(key))
    .map(([key]) => key);

  if (valid.length === 0) return { skippedInvalidNames };

  const printfCalls = valid
    .map(([key, value]) => {
      const exportLine = `export ${key}=${shellQuote(value)}`;
      return `printf '%s\\n' ${shellQuote(exportLine)}`;
    })
    .join(' && \\\n');
  const command = `mkdir -p ~/.creds && \\\n(${printfCalls}) >> ~/.creds/env`;

  const result = await sandboxService.callTool('runCommand', { command });
  if (!result.success) {
    return {
      error: result.error?.message || 'Failed to write credentials into the sandbox',
      skippedInvalidNames,
    };
  }
  return { skippedInvalidNames };
}

/**
 * Server-side Creds Service implementation
 * Wraps MarketService.market.creds to provide ICredsService interface
 */
class ServerCredsService implements ICredsService {
  private marketService: MarketService;
  private workspaceId?: string;
  private getSandboxService?: () => SandboxService;

  constructor(
    marketService: MarketService,
    workspaceId?: string,
    getSandboxService?: () => SandboxService,
  ) {
    this.marketService = marketService;
    this.workspaceId = workspaceId;
    this.getSandboxService = getSandboxService;
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

    // Market's generic inject endpoint resolves organization credentials from
    // the workspaceId signed into this service's trusted-client token.
    const result = await this.marketService.market.creds.inject({
      keys: params.keys,
      sandbox: params.sandbox,
      topicId: params.topicId,
      userId: params.userId,
    });

    log('injectCreds success: notFound=%d', result.notFound?.length || 0);

    // Fetching+decrypting the values is not the same as *injecting* them —
    // `sandbox` defaults true (matches ICredsService.injectCreds' contract of
    // "inject credentials into sandbox"), so unless the caller explicitly
    // opted out, actually write them into the sandbox at the path the
    // creds tool's own system prompt documents (~/.creds/env). Without this
    // the call reports success while leaving the sandbox with nothing to
    // read — the exact bug this fixes.
    const envToWrite = (result as any)?.credentials?.env as Record<string, string> | undefined;
    if (params.sandbox !== false && envToWrite && Object.keys(envToWrite).length > 0) {
      if (!this.getSandboxService) {
        log('injectCreds: sandbox write skipped, no sandbox service available for this context');
      } else {
        const { error, skippedInvalidNames } = await writeEnvCredsToSandbox(
          this.getSandboxService(),
          envToWrite,
        );
        if (skippedInvalidNames?.length) {
          log(
            'injectCreds: skipped %d credential(s) whose key is not a valid shell env var name: %O',
            skippedInvalidNames.length,
            skippedInvalidNames,
          );
        }
        if (error) {
          log('injectCreds: failed to write credentials into sandbox: %s', error);
          throw new Error(
            `Credentials were fetched but could not be written into the sandbox: ${error}`,
          );
        }
        log('injectCreds: wrote %d env var(s) into ~/.creds/env', Object.keys(envToWrite).length);
      }
    }

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

    // Lazy + memoized: only actually constructed if injectCreds needs to
    // write env vars into the sandbox. serverDB/topicId are the same
    // preconditions cloudSandboxRuntime requires for its own sandbox
    // service — when either is missing (e.g. a context without an active
    // sandbox-capable topic) sandbox writing is simply skipped, matching
    // the pre-existing "fetch only" behavior for that case.
    let sandboxService: SandboxService | undefined;
    const getSandboxService = (): SandboxService => {
      if (!sandboxService) {
        if (!context.serverDB || !context.topicId || !context.userId) {
          throw new Error(
            'serverDB, topicId, and userId are required to write creds into the sandbox',
          );
        }
        sandboxService = createSandboxService({
          marketService,
          serverDB: context.serverDB,
          topicId: context.topicId,
          userId: context.userId,
        });
      }
      return sandboxService;
    };

    const credsService = new ServerCredsService(
      marketService,
      context.workspaceId,
      context.serverDB && context.topicId ? getSandboxService : undefined,
    );

    return new CredsExecutionRuntime(credsService, {
      topicId: context.topicId,
      userId: context.userId,
    });
  },
  identifier: CredsIdentifier,
};
