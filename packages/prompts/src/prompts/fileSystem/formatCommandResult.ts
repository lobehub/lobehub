export interface FormatCommandResultParams {
  error?: string;
  exitCode?: number;
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
  } else if (shellId) {
    parts.push(`Command started in background with shell_id: ${shellId}`);
  } else {
    parts.push('Command completed successfully.');
  }

  if (stdout) parts.push(`Output:\n${stdout}`);
  if (stderr) parts.push(`Stderr:\n${stderr}`);

  return parts.join('\n\n');
};
