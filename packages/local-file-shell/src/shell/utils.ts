/** Maximum output length to prevent context explosion */
export const MAX_OUTPUT_LENGTH = 80_000;

/**
 * Truncate string to max length with indicator.
 * ANSI escape codes are preserved so the client can render colored output.
 */
export const truncateOutput = (str: string, maxLength: number = MAX_OUTPUT_LENGTH): string => {
  if (str.length <= maxLength) return str;
  return (
    str.slice(0, maxLength) + '\n... [truncated, ' + (str.length - maxLength) + ' more characters]'
  );
};

/** Get cross-platform shell configuration */
export const getShellConfig = (command: string) =>
  process.platform === 'win32'
    ? { args: ['/c', command], cmd: 'cmd.exe' }
    : { args: ['-c', command], cmd: '/bin/sh' };
