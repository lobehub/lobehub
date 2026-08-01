import type HeterogeneousAgentImplementation from './HeterogeneousAgentImpl';
import { ControllerModule, IpcMethod } from './index';

type Implementation = HeterogeneousAgentImplementation;

/**
 * Registers the stable heterogeneous-agent IPC surface without evaluating the
 * CLI adapters, stream pipeline, quota samplers, and MCP implementation during
 * application startup. The implementation is loaded exactly once on first use.
 */
export default class HeterogeneousAgentCtr extends ControllerModule {
  static override readonly groupName = 'heterogeneousAgent';

  private implementationPromise?: Promise<Implementation>;

  private getImplementation = (): Promise<Implementation> => {
    this.implementationPromise ??= import('./HeterogeneousAgentImpl')
      .then(({ default: Implementation }) => {
        const implementation = new Implementation(this.app);
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
}
