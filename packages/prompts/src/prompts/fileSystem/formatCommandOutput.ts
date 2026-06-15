export interface FormatCommandOutputParams {
  durationMs?: number;
  error?: string;
  exitCode?: number;
  output?: string;
  success: boolean;
}

const formatDuration = (durationMs: number): string => {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${seconds}s`;
};

export const formatCommandOutput = ({
  durationMs,
  success,
  exitCode,
  output,
  error,
}: FormatCommandOutputParams): string => {
  const message = success ? 'Output retrieved.' : `Failed: ${error}`;

  const parts: string[] = [message];
  if (exitCode !== undefined && exitCode !== 0) parts.push(`Exit code: ${exitCode}`);
  if (durationMs !== undefined && Number.isFinite(durationMs)) {
    parts.push(`Duration: ${formatDuration(durationMs)}`);
  }
  if (output) parts.push(`Output:\n${output}`);
  if (error && success) parts.push(`Error: ${error}`);

  return parts.join('\n\n');
};
