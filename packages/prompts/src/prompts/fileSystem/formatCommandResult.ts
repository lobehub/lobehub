import { formatCommandOutputFileSize } from './formatCommandOutput';

export interface FormatCommandResultParams {
  error?: string;
  exitCode?: number;
  outputFiles?: {
    stderr?: { path: string; size?: number; truncated?: boolean };
    stdout?: { path: string; size?: number; truncated?: boolean };
  };
  shellId?: string;
  stderr?: string;
  stdout?: string;
  success: boolean;
}

export const formatCommandResult = ({
  success,
  shellId,
  error,
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

  if (failed) {
    let header = 'Command failed';
    if (hasNonZeroExit) header += ` with exit code ${exitCode}`;
    if (error) header += `: ${error}`;
    parts.push(header);
  } else if (exitCode === undefined) {
    parts.push(`Command is still running after the wait window.\nshell_id: ${shellId}`);
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

  return parts.join('\n\n');
};
