/**
 * Pluggable execution layer under `runCommand`.
 *
 * `ShellProcessManager` owns everything a caller sees — shell ids, output
 * files, observation windows, previews — and delegates only the process
 * lifecycle to a backend. The contract is shaped for three implementations:
 * the non-interactive `child_process` one used today, a pseudo-terminal one
 * (interactive + streaming) and a tmux one (interactive + streaming +
 * persistent). Everything beyond spawn/kill is optional and advertised through
 * `capabilities`, so callers branch on a flag instead of on the backend type.
 */

/** Output files a command writes into; created by the manager before spawn. */
export interface ShellOutputFile {
  fd: number;
  /** Tracks the parent fd only; child stdio close is tracked by ShellProcess.closedAt. */
  fdClosed?: boolean;
  path: string;
}

export interface ShellOutputFiles {
  stderr: ShellOutputFile;
  stdout: ShellOutputFile;
}

/** A fully resolved launch — shell selection and sandbox wrapping already applied. */
export interface ShellLaunchCommand {
  args: string[];
  cmd: string;
}

export interface ShellSpawnOptions {
  /** Terminal width, for backends that allocate a terminal. */
  cols?: number;
  cwd?: string;
  // Structural type instead of NodeJS.ProcessEnv: app tsconfigs augment
  // ProcessEnv with required members, which would leak into this shared
  // package's API and break callers/tests that build plain env objects.
  env: Record<string, string | undefined>;
  /**
   * Where output must land. The manager closes its own copies of these fds as
   * soon as `spawn` returns, so a backend that writes output itself (rather
   * than handing the fds to the child) has to open its own streams on `path`.
   */
  outputFiles: ShellOutputFiles;
  /** Terminal height, for backends that allocate a terminal. */
  rows?: number;
  /** Id the manager will address this command by in `write` / `kill` / `onOutput`. */
  shellId: string;
}

/**
 * Lifecycle view of a running command. `ChildProcess` satisfies it as-is;
 * other backends adapt their native process object to the same events:
 * `exit` when the command ends, `close` once its output is fully flushed,
 * `error` when it could not be started.
 */
export interface ShellHandle {
  readonly exitCode: number | null;
  off: (event: 'close' | 'error' | 'exit', listener: (...args: any[]) => void) => unknown;
  on: (event: 'close' | 'error' | 'exit', listener: (...args: any[]) => void) => unknown;
  once: (event: 'close' | 'error' | 'exit', listener: (...args: any[]) => void) => unknown;
  readonly pid?: number;
  readonly signalCode: NodeJS.Signals | null;
}

export interface ShellBackendCapabilities {
  /** `write` can feed input to a running command. */
  interactive: boolean;
  /** Commands survive the host process and can be reattached. */
  persistent: boolean;
  /** `onOutput` delivers output as it is produced. */
  streaming: boolean;
}

export interface ShellOutputChunk {
  data: string;
  stream: 'stderr' | 'stdout';
}

export interface ShellBackend {
  readonly capabilities: ShellBackendCapabilities;
  /** Whether this backend can run on the current host (e.g. tmux installed). Absent means always. */
  isAvailable?: () => boolean | Promise<boolean>;
  /** Terminate the command and everything it started. Throws when that fails. */
  kill: (shellId: string) => void;
  readonly name: string;
  /** Subscribe to live output. Present only when `capabilities.streaming`. Returns an unsubscribe. */
  onOutput?: (shellId: string, listener: (chunk: ShellOutputChunk) => void) => () => void;
  /** Forget a command the manager no longer tracks. */
  release?: (shellId: string) => void;
  spawn: (command: ShellLaunchCommand, options: ShellSpawnOptions) => ShellHandle;
  /** Send input to a running command. Present only when `capabilities.interactive`. */
  write?: (shellId: string, data: string) => void;
}
