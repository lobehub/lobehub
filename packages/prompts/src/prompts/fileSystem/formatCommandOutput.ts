export interface FormatCommandOutputParams {
  durationMs?: number;
  error?: string;
  exitCode?: number;
  output?: string;
  outputFiles?: {
    stderr?: { path: string; size?: number; truncated?: boolean };
    stdout?: { path: string; size?: number; truncated?: boolean };
  };
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

export const formatCommandOutput = ({
  durationMs,
  success,
  exitCode,
  output,
  outputFiles,
  stderr,
  stdout,
  error,
}: FormatCommandOutputParams): string => {
  const message = success ? 'Output retrieved.' : `Failed: ${error}`;

  const parts: string[] = [message];
  if (exitCode !== undefined && exitCode !== 0) parts.push(`Exit code: ${exitCode}`);
  if (durationMs !== undefined && Number.isFinite(durationMs)) {
    parts.push(`Duration: ${formatDuration(durationMs)}`);
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

  return parts.join('\n\n');
};
