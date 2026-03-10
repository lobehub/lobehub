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

  if (success) {
    if (shellId) {
      parts.push(`Command started in background with shell_id: ${shellId}`);
    } else {
      parts.push('Command completed successfully.');
    }
  } else {
    parts.push(`Command failed: ${error}`);
  }

  if (stdout) parts.push(`Output:\n${stdout}`);
  if (stderr) parts.push(`Stderr:\n${stderr}`);
  if (exitCode !== undefined) parts.push(`Exit code: ${exitCode}`);

  return parts.join('\n\n');
};
