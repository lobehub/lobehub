import type { RemoteServerAuth } from '@/modules/heterogeneousAgent/fileStorePort';

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
  async listModels(...args: Parameters<Implementation['listModels']>) {
    return (await this.getImplementation()).listModels(...args);
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
