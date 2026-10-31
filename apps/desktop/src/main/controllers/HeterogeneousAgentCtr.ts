import type { AntigravityQuotaParams } from '@lobechat/heterogeneous-agents/quota';

import type { ClaudeCodeAccountProfiles } from '@/modules/heterogeneousAgent/claudeCodeAccounts';
import type { RemoteServerAuth } from '@/modules/heterogeneousAgent/fileStorePort';
import { buildProxyEnv } from '@/modules/networkProxy/envBuilder';

import type HeterogeneousAgentImplementation from './HeterogeneousAgentImpl';
import type { LhHeteroExecCancellationResult } from './HeterogeneousAgentImpl';
import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

type Implementation = HeterogeneousAgentImplementation;

/**
 * Registers the stable heterogeneous-agent IPC surface without evaluating the
 * CLI adapters, stream pipeline, quota samplers, and MCP implementation during
 * application startup. The implementation is loaded exactly once on first use.
 */
export default class HeterogeneousAgentCtr extends ControllerModule {
  static override readonly groupName = 'heterogeneousAgent';

  private implementationPromise?: Promise<Implementation>;
  private claudeCodeAccountsPromise?: Promise<ClaudeCodeAccountProfiles>;

  /**
   * Resolved on this side of the lazy boundary and handed to the implementation.
   * This controller lives in the eager main chunk next to `App` and
   * `RemoteServerConfigCtr`; the implementation is a deferred chunk where the
   * same `getController` lookup came back `undefined` at runtime and crashed the
   * main process. Missing controller degrades to "no authed remote server",
   * which makes the image upload a no-op instead of an unhandled rejection.
   */
  private remoteServerAuth: RemoteServerAuth = {
    getAccessToken: async () => (await this.remoteServerConfigCtr?.getAccessToken()) ?? null,
    getServerUrl: async () => (await this.remoteServerConfigCtr?.getRemoteServerUrl()) ?? null,
  };

  private get remoteServerConfigCtr(): RemoteServerConfigCtr | undefined {
    return this.app.getController(RemoteServerConfigCtr);
  }

  private getImplementation = (): Promise<Implementation> => {
    this.implementationPromise ??= import('./HeterogeneousAgentImpl')
      .then(({ default: Implementation }) => {
        const implementation = new Implementation(this.app, this.remoteServerAuth);
        implementation.afterAppReady();
        return implementation;
      })
      .catch((error) => {
        this.implementationPromise = undefined;
        throw error;
      });

    return this.implementationPromise;
  };

  /** Local Claude Code logins (default + per-account profiles), loaded on first use. */
  private getClaudeCodeAccounts = (): Promise<ClaudeCodeAccountProfiles> => {
    this.claudeCodeAccountsPromise ??= Promise.all([
      import('@/modules/heterogeneousAgent/claudeCodeAccountsHost'),
      import('./HeterogeneousAgentImpl'),
    ])
      .then(([{ createClaudeCodeAccountProfiles }, { buildInheritedSpawnEnv }]) =>
        createClaudeCodeAccountProfiles(this.app, () => buildInheritedSpawnEnv()),
      )
      .catch((error) => {
        this.claudeCodeAccountsPromise = undefined;
        throw error;
      });

    return this.claudeCodeAccountsPromise;
  };

  @IpcMethod()
  async startSession(...args: Parameters<Implementation['startSession']>) {
    return (await this.getImplementation()).startSession(...args);
  }

  @IpcMethod()
  async sendPrompt(...args: Parameters<Implementation['sendPrompt']>) {
    return (await this.getImplementation()).sendPrompt(...args);
  }

  @IpcMethod()
  async getSessionInfo(...args: Parameters<Implementation['getSessionInfo']>) {
    return (await this.getImplementation()).getSessionInfo(...args);
  }

  @IpcMethod()
  async listInterruptedRuns(...args: Parameters<Implementation['listInterruptedRuns']>) {
    return (await this.getImplementation()).listInterruptedRuns(...args);
  }

  @IpcMethod()
  async releaseInterruptedRun(...args: Parameters<Implementation['releaseInterruptedRun']>) {
    return (await this.getImplementation()).releaseInterruptedRun(...args);
  }

  @IpcMethod()
  async probeTranscriptReplay(...args: Parameters<Implementation['probeTranscriptReplay']>) {
    return (await this.getImplementation()).probeTranscriptReplay(...args);
  }

  @IpcMethod()
  async listModels(...args: Parameters<Implementation['listModels']>) {
    return (await this.getImplementation()).listModels(...args);
  }

  @IpcMethod()
  async getAntigravityQuota(params: AntigravityQuotaParams = {}) {
    const [{ getAntigravityQuota }, { buildInheritedSpawnEnv }] = await Promise.all([
      import('@lobechat/device-control'),
      import('./HeterogeneousAgentImpl'),
    ]);
    return getAntigravityQuota({
      ...params,
      env: {
        ...buildInheritedSpawnEnv(),
        ...buildProxyEnv(this.app.storeManager.get('networkProxy')),
        ...params.env,
      },
    });
  }

  @IpcMethod()
  async getCodexQuota(...args: Parameters<Implementation['getCodexQuota']>) {
    return (await this.getImplementation()).getCodexQuota(...args);
  }

  @IpcMethod()
  async consumeCodexRateLimitResetCredit(
    ...args: Parameters<Implementation['consumeCodexRateLimitResetCredit']>
  ) {
    return (await this.getImplementation()).consumeCodexRateLimitResetCredit(...args);
  }

  @IpcMethod()
  async getClaudeCodeIdentity(...args: Parameters<Implementation['getClaudeCodeIdentity']>) {
    return (await this.getImplementation()).getClaudeCodeIdentity(...args);
  }

  @IpcMethod()
  async getClaudeCodeQuota(...args: Parameters<Implementation['getClaudeCodeQuota']>) {
    return (await this.getImplementation()).getClaudeCodeQuota(...args);
  }

  /** Every Claude Code account signed in on this machine, and where its login lives. */
  @IpcMethod()
  async listClaudeCodeAccounts() {
    return (await this.getClaudeCodeAccounts()).list();
  }

  /** The local login a run for this provider account must spawn with. */
  @IpcMethod()
  async resolveClaudeCodeAccount(params: { externalAccountId: string }) {
    return (await this.getClaudeCodeAccounts()).resolve(params.externalAccountId);
  }

  /**
   * External-provider routing flags (`CLAUDE_CODE_USE_BEDROCK` …) a session
   * spawn inherits from this desktop's process env. The renderer cannot see
   * that env, yet those flags take the run off the subscription login.
   */
  @IpcMethod()
  async getClaudeCodeInheritedRoutingEnv() {
    const [{ buildInheritedSpawnEnv }, { CLAUDE_CODE_EXTERNAL_ROUTING_ENV_KEYS }] =
      await Promise.all([
        import('./HeterogeneousAgentImpl'),
        import('@lobechat/heterogeneous-agents/quota'),
      ]);
    const inherited = buildInheritedSpawnEnv();
    const flags: Record<string, string> = {};
    for (const key of CLAUDE_CODE_EXTERNAL_ROUTING_ENV_KEYS) {
      const value = inherited[key];
      if (value !== undefined) flags[key] = value;
    }
    return flags;
  }

  /** Sign an account in to its own profile; resolves once the browser login lands. */
  @IpcMethod()
  async loginClaudeCodeAccount(params: { email?: string } = {}) {
    return (await this.getClaudeCodeAccounts()).login(params);
  }

  @IpcMethod()
  async cancelClaudeCodeAccountLogin() {
    return (await this.getClaudeCodeAccounts()).cancelLogin();
  }

  @IpcMethod()
  async getKimiCodeQuota(...args: Parameters<Implementation['getKimiCodeQuota']>) {
    return (await this.getImplementation()).getKimiCodeQuota(...args);
  }

  @IpcMethod()
  async cancelSession(...args: Parameters<Implementation['cancelSession']>) {
    return (await this.getImplementation()).cancelSession(...args);
  }

  @IpcMethod()
  async stopSession(...args: Parameters<Implementation['stopSession']>) {
    return (await this.getImplementation()).stopSession(...args);
  }

  @IpcMethod()
  async respondPermission(...args: Parameters<Implementation['respondPermission']>) {
    return (await this.getImplementation()).respondPermission(...args);
  }

  @IpcMethod()
  async submitIntervention(...args: Parameters<Implementation['submitIntervention']>) {
    return (await this.getImplementation()).submitIntervention(...args);
  }

  spawnLhHeteroExec(...args: Parameters<Implementation['spawnLhHeteroExec']>) {
    return this.getImplementation().then((implementation) =>
      implementation.spawnLhHeteroExec(...args),
    );
  }

  /**
   * Cancels a gateway CLI wrapper through the lazy implementation boundary.
   *
   * Use when:
   * - A server interrupt must stop a device-hosted heterogeneous run.
   *
   * Expects:
   * - The operation id belongs to a wrapper started by this desktop process.
   *
   * Returns:
   * - The wrapper cancellation result, or `undefined` when no wrapper is registered.
   */
  cancelLhHeteroExec(
    ...args: Parameters<Implementation['cancelLhHeteroExec']>
  ): Promise<LhHeteroExecCancellationResult | undefined> {
    return this.getImplementation().then((implementation) =>
      implementation.cancelLhHeteroExec(...args),
    );
  }
}
