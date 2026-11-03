import { formatCommandOutputFileSize } from './formatCommandOutput';

export interface FormatCommandResultParams {
  error?: string;
  exitCode?: number;
  outputFiles?: {
    stderr?: { path: string; size?: number; truncated?: boolean };
    stdout?: { path: string; size?: number; truncated?: boolean };
  };
  /**
   * Whether the command was still executing when the wait window closed. The
   * authoritative signal; `exitCode === undefined` is only a fallback for
   * backends that do not report it.
   */
  running?: boolean;
  shellId?: string;
  /** The signal that terminated the command, when one did. */
  signal?: string;
  stderr?: string;
  stdout?: string;
  success: boolean;
}

export const formatCommandResult = ({
  success,
  running,
  shellId,
  error,
  signal,
  stdout,
  stderr,
  outputFiles,
  exitCode,
}: FormatCommandResultParams): string => {
  const parts: string[] = [];

  // `success` is the envelope ("service responded"); `exitCode` is the command
  // itself. Treat a non-zero exit as failure regardless of envelope success,
  // so we never render "Command completed successfully." over a 137/130/etc.
  const hasNonZeroExit = exitCode !== undefined && exitCode !== 0;
  const failed = !success || hasNonZeroExit;
  // A missing `exitCode` does not by itself mean "still going": a command
  // killed by a signal exits without one. Trust the backend's own liveness when
  // it reports it, and name the signal when it does not.
  const stillRunning = running ?? (exitCode === undefined && !signal);

  if (failed) {
    let header = 'Command failed';
    if (hasNonZeroExit) header += ` with exit code ${exitCode}`;
    if (error) header += `: ${error}`;
    parts.push(header);
  } else if (stillRunning) {
    parts.push(`Command is still running after the wait window.\nshell_id: ${shellId}`);
  } else if (exitCode === undefined && signal) {
    parts.push(`Command was terminated by ${signal}`);
  } else {
    parts.push('Command completed successfully.');
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
  if (stdout) parts.push(`Stdout:\n${stdout}`);
  if (stderr) parts.push(`Stderr:\n${stderr}`);

  // A command that ran but wrote nothing to either stream has to say so. Without
  // the marker, "wrote nothing" and "wrote to stderr, which `2>/dev/null` threw
  // away" render as the same lone header line, and the caller reads that silence
  // as a clean run. Only for a command that actually finished — while it runs,
  // empty output means nothing yet.
  const hasOutput =
    !!stdout || !!stderr || !!outputFiles?.stdout?.path || !!outputFiles?.stderr?.path;
  if (!hasOutput && !stillRunning) parts.push('(no output)');

  return parts.join('\n\n');
};
