export interface FormatCommandOutputParams {
  /**
   * Whether this backend's `getCommandOutput` schema actually offers a
   * `timeout`. Off by default: advising the reader to wait longer in one call
   * is worse than silence when the tool it is holding cannot do that.
   */
  canWaitLonger?: boolean;
  durationMs?: number;
  error?: string;
  exitCode?: number;
  /**
   * The regex the caller applied to the output lines, when it applied one. Only
   * used to explain an empty render: filtered-to-nothing and wrote-nothing are
   * otherwise the same blank result.
   */
  filter?: string;
  output?: string;
  outputFiles?: {
    stderr?: { path: string; size?: number; truncated?: boolean };
    stdout?: { path: string; size?: number; truncated?: boolean };
  };
  /**
   * Whether the command was still executing at observation time. Resolved by the
   * caller (which knows the service's own lifecycle reporting) rather than
   * inferred here, so a service that reports liveness directly is believed.
   */
  running?: boolean;
  /** Session id to poll or kill, echoed back so a still-running result is actionable. */
  shellId?: string;
  stderr?: string;
  stdout?: string;
  success: boolean;
}

const formatDuration = (durationMs: number): string => {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${seconds}s`;
};

export const formatCommandOutputFileSize = (size?: number): string => {
  if (typeof size !== 'number' || !Number.isFinite(size)) return 'unknown size';
  const kb = size / 1024;
  if (kb < 1) return `${size} bytes`;
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, '')}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1).replace(/\.0$/, '')}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1).replace(/\.0$/, '')}GB`;
};

/**
 * Render one observation of a shell session for the model.
 *
 * The header has to state the lifecycle, because every other field reads the
 * same in both states: a command still buffering its first byte and a command
 * that exited 0 having printed nothing both produce an empty output and a
 * 0-byte log. Left unstated, the reader's only way to tell them apart is to go
 * hunting through `ps`/`pgrep` — or to poll the same session until a repeat
 * guard cuts it off. `formatCommandResult` (the `runCommand` side) has always
 * named the state; this is the same vocabulary so both tools read alike.
 */
export const formatCommandOutput = ({
  canWaitLonger,
  durationMs,
  success,
  exitCode,
  filter,
  output,
  outputFiles,
  running,
  shellId,
  stderr,
  stdout,
  error,
}: FormatCommandOutputParams): string => {
  const hasNonZeroExit = exitCode !== undefined && exitCode !== 0;

  const header = (): string => {
    // `success` is the envelope — the observation came back. It says nothing
    // about the command, which is what `running`/`exitCode` are for.
    if (!success) return `Failed: ${error}`;
    if (running) {
      const lines = ['Command is still running.'];
      if (shellId) lines.push(`shell_id: ${shellId}`);
      return lines.join('\n');
    }
    if (hasNonZeroExit) return `Command failed with exit code ${exitCode}`;
    if (exitCode === 0) return 'Command completed successfully.';
    // No lifecycle reported at all: say only what we know.
    return 'Output retrieved.';
  };

  const parts: string[] = [header()];

  if (success && running) {
    parts.push(
      canWaitLonger
        ? 'Pass a larger `timeout` (ms) to wait for it within a single call instead of polling repeatedly; `killCommand` ends the session.'
        : 'Give it time before checking again; `killCommand` ends the session.',
    );
  }

  if (durationMs !== undefined && Number.isFinite(durationMs)) {
    // The same field means elapsed-so-far while running and total once exited.
    const elapsed = formatDuration(durationMs);
    parts.push(running ? `Elapsed: ${elapsed}` : `Duration: ${elapsed}`);
  }
  if (outputFiles?.stdout?.path) {
    const size = formatCommandOutputFileSize(outputFiles.stdout.size);
    parts.push(
      outputFiles.stdout.truncated
        ? `Stdout too large (${size}). Full stdout saved to: ${outputFiles.stdout.path}`
        : `Full stdout saved to: ${outputFiles.stdout.path} (${size})`,
    );
  }
  if (outputFiles?.stderr?.path) {
    const size = formatCommandOutputFileSize(outputFiles.stderr.size);
    parts.push(
      outputFiles.stderr.truncated
        ? `Stderr too large (${size}). Full stderr saved to: ${outputFiles.stderr.path}`
        : `Full stderr saved to: ${outputFiles.stderr.path} (${size})`,
    );
  }
  if (output) parts.push(`Output:\n${output}`);
  if (stdout) parts.push(`Stdout:\n${stdout}`);
  if (stderr) parts.push(`Stderr:\n${stderr}`);
  if (error && success) parts.push(`Error: ${error}`);

  // Nothing rendered above the fold has to be explained, or silence gets read
  // as a clean run. Three different causes look identical without this.
  if (!output && !stdout && !stderr) {
    const bytesOnDisk = (outputFiles?.stdout?.size ?? 0) + (outputFiles?.stderr?.size ?? 0);
    if (filter && bytesOnDisk > 0) {
      parts.push(
        `(filter ${JSON.stringify(filter)} matched no lines — call again without \`filter\` to see the raw output)`,
      );
    } else if (running) {
      parts.push('(no output yet)');
    } else if (exitCode !== undefined) {
      parts.push('(no output)');
    }
  }

  return parts.join('\n\n');
};
