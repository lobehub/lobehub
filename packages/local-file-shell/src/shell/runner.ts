import type { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SandboxPolicy } from '@lobechat/device-sandbox';

import type { RunCommandParams, RunCommandResult } from '../types';
import type { ShellBackend, ShellOutputFiles } from './backend';
import { ChildProcessBackend } from './child-process-backend';
import { registerDeviceOperationResource } from './deviceOperation';
import type { ShellProcess, ShellProcessManager } from './process-manager';
import { DEFAULT_OBSERVATION_TIMEOUT_MS } from './process-manager';
import { detectWindowsShell, getShellConfig, normalizeEnvVarRefs } from './utils';

export interface RunCommandOptions {
  /** Backend to spawn with; defaults to the process manager's own. */
  backend?: ShellBackend;
  logger?: {
    debug: (...args: any[]) => void;
    error: (...args: any[]) => void;
    info: (...args: any[]) => void;
  };
  /**
   * The sandbox could not be established for this command (unsupported host,
   * missing dependency, a runtime that refused the policy). Fired only for
   * failures raised while building the launch plan — never for a command that
   * ran sandboxed and exited non-zero.
   *
   * Exists because the cheap capability probe is not the whole truth: the
   * backend can report itself available and still fail when the first real
   * process is spawned (the egress fence is only verified then). Callers use
   * this to downgrade what they advertise instead of offering an environment
   * that fails on every command.
   */
  onSandboxUnavailable?: (error: Error) => void;
  processManager: ShellProcessManager;
  sandboxPolicy?: SandboxPolicy;
  /**
   * Spawn function for the default child-process backend (e.g. one that
   * registers the process with a tracker). Ignored when {@link backend} is set.
   */
  spawnProcess?: typeof spawn;
  /**
   * Root directory for the isolated fallback directory (see below). Defaults
   * to `os.tmpdir()`. Test/DI hook — the fallback and its reporting are the
   * behaviors under test, not the specific directory.
   */
  tmpdirOverride?: string;
}

/**
 * `true` = resolves to a directory; `false` = resolves to a non-directory
 * (a regular file); `undefined` = cannot be resolved at all (missing, an
 * unreadable parent, a symlink loop). Keeping the three cases apart lets the
 * report name what actually happened instead of guessing.
 */
const statIsDirectory = async (dir: string): Promise<boolean | undefined> => {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return undefined;
  }
};

interface WorkingDirectoryResolution {
  /** The directory to spawn in, when the request was honored or a fallback was found. */
  cwd?: string;
  /** Structured failure: no usable directory anywhere, or a sandboxed run that must not move. */
  error?: string;
  /**
   * Set when the requested cwd was unusable and the run fell back. Prepended to
   * the command's output so the model sees the caveat next to whatever the
   * command printed from the fallback directory.
   */
  notice?: string;
  /**
   * Removes the fallback directory once nothing is running in it. Only set when
   * the cwd is a fresh fallback; without this, every command against a stale
   * cwd would leave another directory (and anything the command wrote into it)
   * under the temp root forever.
   */
  remove?: () => Promise<void>;
}

/**
 * Resolve a requested cwd to a directory the shell can actually start in.
 *
 * A cwd pinned on another machine (a stale repo path, a moved worktree) would
 * otherwise kill every command in the run: the run cannot change its own pinned
 * cwd, callers strip a model-supplied cwd before dispatch, and re-running
 * `cd` inside the command does not help because the check happens before the
 * shell exists — so the same failure repeats forever. Un-sandboxed runs fall
 * back to a fresh isolated directory created under the OS temp root, and the
 * fallback is reported so nothing downstream mistakes it for the requested
 * directory.
 *
 * Sandboxed runs do NOT fall back: the sandbox fence (`createLocalSandboxPolicy`)
 * is built on the requested cwd, so silently spawning in another directory
 * would grant writes somewhere the user never approved. Those fail loudly.
 */
const resolveWorkingDirectory = async (
  requestedCwd: string,
  sandboxRequested: boolean,
  fallbackRoot: string | undefined,
): Promise<WorkingDirectoryResolution> => {
  const usable = await statIsDirectory(requestedCwd);
  if (usable) return { cwd: requestedCwd };

  const reason =
    usable === false
      ? `Working directory is not a directory on ${os.hostname()}: ${requestedCwd}`
      : `Working directory does not exist on ${os.hostname()}: ${requestedCwd}`;

  if (sandboxRequested) {
    return {
      error: `${reason}. A sandboxed run must start in its requested directory — the sandbox fence is built on it — so the command was not run.`,
    };
  }

  // The fallback is a fresh, empty directory rather than an existing one: a
  // populated fallback (the user's home) would run project-relative commands
  // like `rm -rf ./*` against someone else's files before the notice even
  // reaches the model. An empty directory cannot be damaged that way, and the
  // notice plus the visible `pwd` make the move impossible to miss.
  try {
    const fallback = await mkdtemp(path.join(fallbackRoot ?? os.tmpdir(), 'lobehub-cwd-fallback-'));
    return {
      cwd: fallback,
      notice: `${reason}. Falling back to ${fallback}.`,
      // Best-effort cleanup: the fallback is empty and lives under the OS temp
      // root, so a missed removal is only a small leak — never lose the run
      // over it.
      remove: async () => {
        await rm(fallback, { force: true, recursive: true });
      },
    };
  } catch {
    // No usable fallback: keep the structured error instead of letting the
    // spawn surface a misleading `spawn <shell> ENOENT`.
    return {
      error: `${reason}. The shell is fine — run the command from a directory that exists on this device.`,
    };
  }
};

export async function runCommand(
  {
    command,
    cwd,
    description,
    env: extraEnv,
    run_in_background,
    timeout = DEFAULT_OBSERVATION_TIMEOUT_MS,
  }: RunCommandParams,
  {
    backend: backendOverride,
    processManager,
    logger,
    onSandboxUnavailable,
    sandboxPolicy,
    spawnProcess,
    tmpdirOverride,
  }: RunCommandOptions,
): Promise<RunCommandResult> {
  if (!command) {
    return { error: 'command is required', success: false };
  }

  // A caller-supplied spawn function (the desktop's managed-process tracker)
  // still runs through the child-process backend, so kill / release reach it.
  const backend =
    backendOverride ??
    (spawnProcess ? new ChildProcessBackend(spawnProcess) : processManager.backend);
  const logPrefix = `[runCommand: ${description || command.slice(0, 50)}]`;
  logger?.debug(`${logPrefix} Starting`, { background: run_in_background, cwd, timeout });

  let effectiveCwd = cwd;
  let cwdNotice: string | undefined;
  // Set only when the cwd fell back to a fresh directory; invoked once nothing
  // is running in it anymore (see the `close` wiring below).
  let removeCwdFallback: (() => Promise<void>) | undefined;
  if (cwd) {
    const resolution = await resolveWorkingDirectory(cwd, !!sandboxPolicy, tmpdirOverride);
    if (resolution.error) return { error: resolution.error, success: false };
    effectiveCwd = resolution.cwd;
    cwdNotice = resolution.notice;
    removeCwdFallback = resolution.remove;
  }

  const requestedEnv = extraEnv ? { ...process.env, ...extraEnv } : process.env;

  // On Windows, rewrite env-var references the target shell cannot resolve
  // natively into its own syntax (see normalizeEnvVarRefs), so a command
  // authored in another shell dialect still resolves against the actual env.
  // We do NOT rewrite on macOS/Linux: /bin/sh handles its own variable syntax,
  // and rewriting here would break shell-local variables (e.g. `for x; do echo $x`).
  const effectiveCommand =
    process.platform === 'win32'
      ? normalizeEnvVarRefs(command, requestedEnv, (await detectWindowsShell()).type)
      : command;
  const shellConfig = await getShellConfig(effectiveCommand);
  let outputFiles: ShellOutputFiles | undefined;
  // Whether the spawned process made it into the process manager. Past this
  // point a thrown error must NOT remove the fallback: the process is still
  // running in it, and its eventual `close` event owns the cleanup.
  let registered = false;
  let releaseSandbox: (() => void) | undefined;
  // What actually happened, reported back so nothing downstream has to infer a
  // security property from the request that asked for it.
  let sandboxed: boolean | undefined;

  try {
    let launchCommand = shellConfig;
    let launchEnv: NodeJS.ProcessEnv = requestedEnv;

    // The device sandbox is an opt-in PoC. Keep the existing runner path untouched unless a caller
    // explicitly supplies a policy, and avoid loading the experimental runtime on the default path.
    if (sandboxPolicy) {
      const { createSandboxLaunchPlan } = await import('@lobechat/device-sandbox');
      // Narrow try/catch: only a failure to BUILD the sandbox counts as the
      // sandbox being unavailable. Everything after this — spawn errors, a
      // non-zero exit — is the command's own failure and must not make the
      // caller think the environment is broken.
      let launchPlan;
      try {
        launchPlan = await createSandboxLaunchPlan({
          command: shellConfig,
          cwd: effectiveCwd,
          env: requestedEnv,
          policy: sandboxPolicy,
        });
      } catch (error) {
        onSandboxUnavailable?.(error as Error);
        throw error;
      }
      launchCommand = launchPlan;
      launchEnv = launchPlan.env as NodeJS.ProcessEnv;
      releaseSandbox = launchPlan.release;
      sandboxed = launchPlan.sandboxed;
    }
    const shellId = processManager.createShellId();
    const shellOutputFiles = processManager.createOutputFiles(shellId);
    outputFiles = shellOutputFiles;
    const handle = backend.spawn(
      { args: launchCommand.args, cmd: launchCommand.cmd },
      { cwd: effectiveCwd, env: launchEnv, outputFiles: shellOutputFiles, shellId },
    );
    registerDeviceOperationResource(() => backend.terminate?.(shellId) ?? Promise.resolve(false));

    const shellProcess: ShellProcess = {
      backend,
      exitCode: null,
      outputFiles: shellOutputFiles,
      process: handle,
    };

    handle.on('exit', (code: number | null) => {
      logger?.debug(`${logPrefix} Process exited`, { code, shellId });
      shellProcess.exitCode = code ?? 0;
    });

    handle.on('error', (error: Error) => {
      logger?.error(`${logPrefix} Command failed:`, error);
      const cwdContext = cwd ? ` (working directory: ${cwd})` : '';
      shellProcess.spawnError = new Error(
        `Failed to start command${cwdContext}: ${error.message}`,
        {
          cause: error,
        },
      );
      shellProcess.exitCode = 1;
    });
    handle.once('close', () => {
      releaseSandbox?.();
      // Best-effort removal of the cwd fallback directory once nothing can be
      // using it. `close` fires after exit *and* after all stdio has flushed,
      // so nothing reads or writes the fallback anymore. Background runs,
      // kills (SIGKILL has no exit callback) and `cleanupAll()` all end in a
      // `close` event, so this is the one choke point that covers every exit
      // path. Removal races are tolerated by design: a command that wrote into
      // the fallback loses only its own temp files.
      if (removeCwdFallback) {
        removeCwdFallback().catch((error) => {
          logger?.debug(`${logPrefix} Fallback directory cleanup failed`, { error });
        });
      }
    });

    processManager.register(shellId, shellProcess);
    registered = true;
    // Close our fd copy only after error/close listeners are registered; spawn errors are asynchronous.
    processManager.closeOutputFiles(shellOutputFiles);
    logger?.info?.(`${logPrefix} Started session`, { background: run_in_background, shellId });

    if (run_in_background) {
      return {
        output: cwdNotice ?? '',
        output_files: processManager.getOutputFilesInfo(shellOutputFiles),
        sandboxed,
        shell_id: shellId,
        success: true,
      };
    }

    const observation = await processManager.getRunCommandOutput({
      shell_id: shellId,
      timeout,
    });

    const result: RunCommandResult = { ...observation, sandboxed, shell_id: shellId };
    if (!cwdNotice) return result;
    // Put the caveat before whatever the command printed, so the model reads
    // the fallback next to the output it produced from the fallback directory.
    const prefix = `${cwdNotice}\n\n`;
    return {
      ...result,
      output: `${prefix}${result.output ?? ''}`,
      stdout: `${prefix}${result.stdout ?? ''}`,
    };
  } catch (error) {
    releaseSandbox?.();
    if (outputFiles) processManager.closeOutputFiles(outputFiles);
    // The spawn never happened (shell config, sandbox plan build, or a spawn
    // throw before registration): no `close` event will fire, so remove the
    // fallback here instead of leaking it. After registration the process is
    // running in the fallback — its `close` event owns the cleanup.
    if (removeCwdFallback && !registered) {
      await removeCwdFallback().catch(() => {});
    }
    return { error: (error as Error).message, success: false };
  }
}
