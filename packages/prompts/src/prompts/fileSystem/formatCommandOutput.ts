export interface FormatCommandOutputParams {
  error?: string;
  exitCode?: number;
  output?: string;
  success: boolean;
}

export const formatCommandOutput = ({
  success,
  exitCode,
  output,
  error,
}: FormatCommandOutputParams): string => {
  const message = success ? 'Output retrieved.' : `Failed: ${error}`;

  const parts: string[] = [message];
  if (exitCode !== undefined) parts.push(`Exit code: ${exitCode}`);
  if (output) parts.push(`Output:\n${output}`);
  if (error && success) parts.push(`Error: ${error}`);

  return parts.join('\n\n');
};
