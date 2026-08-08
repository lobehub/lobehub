import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';

import { createSandboxEnv } from './env';
import { createSrtConfig } from './srt';
import type { CreateSandboxLaunchPlanOptions, SandboxCapability, SandboxLaunchPlan } from './types';
import { SandboxError } from './types';

const quoteShellArgument = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

const serializeCommand = (command: { args: string[]; cmd: string }): string =>
  [command.cmd, ...command.args].map(quoteShellArgument).join(' ');

const configFingerprint = (config: SandboxRuntimeConfig): string => JSON.stringify(config);

export class SrtSandboxRuntime {
  private activeCommands = 0;
  private initialization?: Promise<void>;
  private initializedFingerprint?: string;

  private async ensureInitialized(config: SandboxRuntimeConfig): Promise<void> {
    const requestedFingerprint = configFingerprint(config);

    if (this.initialization) await this.initialization;

    if (this.initializedFingerprint) {
      if (this.initializedFingerprint !== requestedFingerprint) {
        throw new SandboxError(
          'SANDBOX_POLICY_CONFLICT',
          'Sandbox Runtime is already initialized with a different device policy',
        );
      }
      return;
    }

    this.initialization = SandboxManager.initialize(config, undefined, true);
    try {
      await this.initialization;
      const initializedConfig = SandboxManager.getConfig();
      if (!initializedConfig || configFingerprint(initializedConfig) !== requestedFingerprint) {
        throw new SandboxError(
          'SANDBOX_POLICY_CONFLICT',
          'Sandbox Runtime is owned by another caller with a different device policy',
        );
      }
      this.initializedFingerprint = requestedFingerprint;
    } finally {
      this.initialization = undefined;
    }
  }

  async createLaunchPlan(
    options: CreateSandboxLaunchPlanOptions,
    capability: SandboxCapability,
  ): Promise<SandboxLaunchPlan> {
    const config = createSrtConfig(options.policy);
    await this.ensureInitialized(config);

    const wrapped = await SandboxManager.wrapWithSandboxArgv(
      serializeCommand(options.command),
      '/bin/sh',
      undefined,
      undefined,
      options.cwd ?? process.cwd(),
    );

    this.activeCommands += 1;
    let released = false;

    return {
      args: wrapped.argv.slice(1),
      capability,
      cmd: wrapped.argv[0],
      env:
        process.platform === 'win32'
          ? wrapped.env
          : createSandboxEnv(options.env ?? process.env, options.policy),
      release: () => {
        if (released) return;
        released = true;
        this.activeCommands -= 1;
        SandboxManager.cleanupAfterCommand();
      },
      sandboxed: true,
    };
  }

  async shutdown(): Promise<void> {
    if (this.initialization) await this.initialization;
    if (this.activeCommands > 0) {
      throw new SandboxError(
        'SANDBOX_BUSY',
        `Cannot reset Sandbox Runtime while ${this.activeCommands} command(s) are active`,
      );
    }

    if (SandboxManager.isSandboxingEnabled()) await SandboxManager.reset();
    this.initializedFingerprint = undefined;
  }
}

export const srtSandboxRuntime = new SrtSandboxRuntime();
