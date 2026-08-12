import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { SandboxCapability } from '@lobechat/device-sandbox';
import type {
  DesktopShellSettings,
  DeviceSandboxCapabilityResult,
  DeviceSandboxInstallResult,
  EnsureSandboxWorkspaceParams,
  EnsureSandboxWorkspaceResult,
  GetCommandOutputParams,
  GetCommandOutputResult,
  KillCommandParams,
  KillCommandResult,
  RunCommandParams,
  RunCommandResult,
  SetShellModeParams,
} from '@lobechat/electron-client-ipc';
import {
  findGitBash,
  getShellInfo,
  runCommand,
  setWindowsShellPreference,
  ShellProcessManager,
} from '@lobechat/local-file-shell/shell';

import { createLogger } from '@/utils/logger';

import CliCtr from './CliCtr';
import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:ShellCommandCtr');

const processManager = new ShellProcessManager();

/**
 * Agent ids are opaque to this process, and they end up as a path segment —
 * so anything that is not plainly a name is stripped rather than trusted.
 */
const safeSegment = (value: string): string => value.replaceAll(/[^\w-]/g, '') || 'default';

/** Prefix for a simple `lh`/`lobe`/`lobehub` invocation (keyword + boundary, args via slice). */
const SIMPLE_LH_PREFIX = /^\s*(?:lh|lobe|lobehub)(?=\s|$)/;

export default class ShellCommandCtr extends ControllerModule {
  static override readonly groupName = 'shellCommand';

  /**
   * Apply the persisted Windows shell preference before any command runs, so
   * the local-file-shell detection chain honors it from the first execution.
   */
  beforeAppReady() {
    if (process.platform !== 'win32') return;
    const mode = this.app.storeManager.get('windowsShellMode', 'auto');
    setWindowsShellPreference(mode);
    logger.debug('Applied Windows shell preference:', mode);
  }

  @IpcMethod()
  async getShellSettings(): Promise<DesktopShellSettings> {
    const gitBashPath = process.platform === 'win32' ? await findGitBash() : undefined;
    const { displayName, path } = await getShellInfo();

    return {
      currentShell: { displayName, path },
      gitBashAvailable: !!gitBashPath,
      gitBashPath,
      mode: this.app.storeManager.get('windowsShellMode', 'auto'),
    };
  }

  @IpcMethod()
  async setShellMode({ mode }: SetShellModeParams): Promise<DesktopShellSettings> {
    if (mode === 'gitbash' && !(await findGitBash())) {
      throw new Error('Git Bash is not installed');
    }

    this.app.storeManager.set('windowsShellMode', mode);
    setWindowsShellPreference(mode);
    logger.info('Windows shell mode updated:', mode);

    const settings = await this.getShellSettings();

    // Push the new shell to every renderer so the `{{defaultShell}}` prompt
    // placeholder flips immediately — otherwise the model keeps emitting
    // commands for the previous shell until the app restarts.
    this.app.browserManager.broadcastToAllWindows('appStateUpdated', {
      defaultShell: settings.currentShell.displayName,
    });

    return settings;
  }

  /**
   * Capability verdict, resolved at most once per app run and downgradable.
   *
   * Imported dynamically on purpose: a static import would pull
   * `@anthropic-ai/sandbox-runtime` into every desktop launch. Nothing loads
   * SRT until someone actually asks for a sandbox.
   */
  private sandboxCapability?: Promise<SandboxCapability>;

  private probeSandbox(): Promise<SandboxCapability> {
    return (this.sandboxCapability ??= (async () => {
      try {
        const { probeSandboxCapability } = await import('@lobechat/device-sandbox');
        return await probeSandboxCapability();
      } catch (error) {
        // The probe itself can throw on an unsupported host instead of
        // reporting unavailability. Any failure means "no sandbox here" — the
        // picker must never offer the option on the strength of a crashed
        // probe.
        logger.warn('Sandbox capability probe failed:', error);
        return {
          available: false,
          backend: 'none' as const,
          networkIsolation: false,
          reason: (error as Error).message,
        };
      }
    })());
  }

  /**
   * Record that the sandbox could not actually be established, so the picker
   * stops offering it.
   *
   * The cheap probe only checks that the backend is installed and its
   * dependencies resolve; parts of the fence (on Windows, the egress filter and
   * the secondary-logon spawn) are exercised only when the first real process
   * starts. A host can therefore pass the probe and still fail every command —
   * observed on a Windows machine where `CreateProcessWithLogonW` is denied.
   * Without this the user re-picks a permanently broken environment forever.
   *
   * Downgrade only, never an upgrade: a host that failed once stays failed for
   * this app run. Recovering usually means installing something, which means
   * restarting anyway.
   */
  private downgradeSandboxCapability(error: Error) {
    logger.warn('Sandbox unavailable at launch, downgrading capability:', error);
    this.sandboxCapability = Promise.resolve({
      available: false,
      backend: 'none' as const,
      networkIsolation: false,
      reason: error.message,
    });
  }

  /**
   * Whether this host can run sandboxed commands at all. The renderer asks
   * before offering the "Local Sandbox" execution environment, so an
   * unsupported host shows a disabled row carrying the real reason — and, when
   * the app can fix it, a button — instead of an option that fails on first
   * use.
   */
  @IpcMethod()
  async getSandboxCapability(): Promise<DeviceSandboxCapabilityResult> {
    const capability = await this.probeSandbox();
    const { canInstallSandbox } = await import('@lobechat/device-sandbox');
    return {
      available: capability.available,
      // Only worth advertising while something is actually missing.
      canInstall: !capability.available && canInstallSandbox(),
      reason: capability.reason,
    };
  }

  /**
   * Provision the sandbox backend on this machine, then re-read the capability.
   *
   * Users install the desktop app expecting its features to work; making them
   * run a CLI first would be a broken promise. This is that setup, behind an
   * explicit click — it raises a UAC prompt and creates a dedicated Windows
   * account, which must never happen implicitly.
   *
   * Always clears the cached verdict first: the whole point is to re-evaluate a
   * host that previously said no, including one downgraded by a failed launch.
   */
  /**
   * Create the default workspace a sandboxed agent runs in, and return its real
   * path.
   *
   * The sandbox fences writes to the run's working directory, so without one
   * there is nothing to fence and the command is refused. Making the user go
   * find a folder before the feature does anything is a poor first run, so the
   * picker calls this and then *writes the result into the visible working-
   * directory setting* — a default the user can see and change, not a hidden
   * one. A directory nobody can point at is how "the UI says one thing, the run
   * does another" starts.
   *
   * Created eagerly rather than lazily at launch because the policy layer
   * resolves its roots with `realpath` and rejects a path that does not exist
   * yet.
   */
  @IpcMethod()
  async ensureSandboxWorkspace({
    agentId,
  }: EnsureSandboxWorkspaceParams): Promise<EnsureSandboxWorkspaceResult> {
    const target = path.join(os.homedir(), 'LobeHub', 'sandbox', safeSegment(agentId));
    try {
      fs.mkdirSync(target, { recursive: true });
      // Resolve symlinks now: this exact string becomes the fence root, and the
      // policy layer compares realpaths.
      const resolved = fs.realpathSync.native(target);
      logger.info('Prepared sandbox workspace:', resolved);
      return { path: resolved };
    } catch (error) {
      logger.error('Failed to prepare sandbox workspace:', error);
      return { reason: (error as Error).message };
    }
  }

  @IpcMethod()
  async installSandbox(): Promise<DeviceSandboxInstallResult> {
    const { installDeviceSandbox } = await import('@lobechat/device-sandbox');

    let status: DeviceSandboxInstallResult['status'] = 'failed';
    let error: string | undefined;
    let instructions: string | undefined;

    try {
      const result = await installDeviceSandbox();
      status = result.status;
      instructions = result.instructions;
      logger.info('Sandbox setup finished with status:', status);
    } catch (caught) {
      error = (caught as Error).message;
      logger.error('Sandbox setup failed:', caught);
    }

    // Re-probe unconditionally. A cancelled or failed attempt can still have
    // changed the host (the installer is idempotent and partially completes),
    // and a stale "unavailable" would keep the option switched off after a
    // setup that actually worked.
    this.sandboxCapability = undefined;
    const capability = await this.getSandboxCapability();

    return { capability: { ...capability, instructions }, error, status };
  }

  @IpcMethod()
  async handleRunCommand(params: RunCommandParams): Promise<RunCommandResult> {
    const prefixMatch = SIMPLE_LH_PREFIX.exec(params.command);
    if (prefixMatch) {
      const cliCtr = this.app.getController(CliCtr);
      if (cliCtr) {
        // Deliberate carve-out: `lh` keeps its in-app route even for a
        // sandboxed run. It is LobeHub's own control-plane CLI — it needs the
        // injected `LOBEHUB_JWT` and the server it talks to, both of which the
        // sandbox strips (env allowlist) and blocks (no network). Sandboxing it
        // would not harden anything the model can reach through it; it would
        // just break agent self-management. The sandbox's promise is about
        // model-authored shell commands, and this is not one.
        const args = params.command.slice(prefixMatch[0].length).trim();
        logger.debug('Routing lh command to CliCtr.runCliCommand:', args);
        const result = await cliCtr.runCliCommand(args);
        return {
          exit_code: result.exitCode,
          output: result.stdout + result.stderr,
          stderr: result.stderr,
          stdout: result.stdout,
          success: result.exitCode === 0,
        };
      }
    }

    if (!params.sandbox) return runCommand(params, { logger, processManager });

    // Sandboxed run. The policy is scoped to the run's working directory, so
    // without one there is nothing to scope to — refuse rather than fall back
    // to `process.cwd()` (the app install directory on a packaged desktop),
    // which would confine writes to a place the user never chose while still
    // reporting success.
    //
    // `params.cwd` is trusted as the fence root because both callers strip the
    // model's own `cwd` before dispatch and re-inject the run's configured
    // working directory — the server device-proxy unconditionally, and the
    // client executor via the runtime's `trustArgsCwd: false` path. This
    // process cannot re-check that (it has no idea which directory the agent
    // was configured with), so the guarantee is pinned by tests on both
    // injection sites instead.
    if (!params.cwd) {
      return {
        error:
          'Local Sandbox requires a working directory. Set one for this agent (or topic) and run the command again.',
        success: false,
      };
    }

    // Check the host up front so an unsupported one gets a named, actionable
    // failure. `createLocalSandboxPolicy` uses `onUnavailable: 'deny'`, so the
    // command would fail anyway — but the runner reports the raw backend reason
    // ("Sandbox Runtime dependencies are unavailable: …"), which reads like a
    // crash rather than "this environment isn't available on your machine".
    const capability = await this.probeSandbox();
    if (!capability.available) {
      return {
        error: `Local Sandbox is unavailable on this device: ${capability.reason ?? 'unsupported host'}. Switch the agent's execution environment to run this command.`,
        success: false,
      };
    }

    const { createLocalSandboxPolicy } = await import('@lobechat/device-sandbox');

    // `runCommand` converts sandbox failures (policy conflict, busy runtime,
    // a fence that cannot be established) into `{ success: false, error }`
    // itself. It never falls back to an unsandboxed spawn, which is the
    // guarantee the user opted into.
    return runCommand(params, {
      logger,
      onSandboxUnavailable: (error) => this.downgradeSandboxCapability(error),
      processManager,
      sandboxPolicy: createLocalSandboxPolicy(params.cwd, {
        allowNetwork: params.sandboxNetwork === true,
      }),
    });
  }

  @IpcMethod()
  async handleGetCommandOutput(params: GetCommandOutputParams): Promise<GetCommandOutputResult> {
    return processManager.getOutput(params);
  }

  @IpcMethod()
  async handleKillCommand({ shell_id }: KillCommandParams): Promise<KillCommandResult> {
    return processManager.kill(shell_id);
  }
}
