export interface FormatCommandOutputParams {
  error?: string;
  output?: string;
  running: boolean;
  success: boolean;
}

export const formatCommandOutput = ({
  success,
  running,
  output,
  error,
}: FormatCommandOutputParams): string => {
  const message = success ? `Output retrieved. Running: ${running}` : `Failed: ${error}`;

  const parts: string[] = [message];
  if (output) parts.push(`Output:\n${output}`);
  if (error && success) parts.push(`Error: ${error}`);

  return parts.join('\n\n');
};
