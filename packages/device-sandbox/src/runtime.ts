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
      if (this.initializedFingerprint === requestedFingerprint) return;

      // The backend holds ONE policy per process, and the working directory is
      // part of it — so switching agents, opening a second project, or flipping
      // the network toggle all arrive here. Refusing them would make the
      // sandbox usable exactly once per app launch.
      //
      // Re-initializing is safe only while nothing is running under the old
      // policy: a live command's fence must never be swapped out from under it.
      // `shutdown` enforces that and throws SANDBOX_BUSY otherwise, which is the
      // honest answer — the caller retries once the other command finishes.
      if (this.activeCommands > 0) {
        throw new SandboxError(
          'SANDBOX_POLICY_CONFLICT',
          `Sandbox Runtime is busy with ${this.activeCommands} command(s) under a different device policy`,
        );
      }

      await this.shutdown();
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

    // The shell the sandboxed child runs under has to be one that exists on
    // this OS. `/bin/sh` was hardcoded here, which is why every Windows launch
    // died with `CreateProcessAsUserW(/bin/sh): path not found` even after the
    // fence itself came up cleanly.
    //
    // The caller already resolved the right shell for the platform
    // (`getShellConfig` → Git Bash / PowerShell / cmd, with the command as the
    // final argv entry), so reuse it rather than guessing again: the sandboxed
    // spawn then matches the unsandboxed one exactly, flags included.
    const { args, cmd } = options.command;
    const [command, binShell] =
      process.platform === 'win32'
        ? [args.at(-1) ?? '', { args: args.slice(0, -1), exe: cmd }]
        : [serializeCommand(options.command), '/bin/sh'];

    const wrapped = await SandboxManager.wrapWithSandboxArgv(
      command,
      binShell,
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
