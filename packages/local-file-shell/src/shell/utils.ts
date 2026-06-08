/** Maximum output length to prevent context explosion */
export const MAX_OUTPUT_LENGTH = 80_000;

/** ANSI SGR reset, closes any open color/style state */
const ANSI_RESET = '\u001B[0m';

/** Matches a complete ANSI escape sequence anchored at the start of the string */
// eslint-disable-next-line no-control-regex, regexp/no-obscure-range
const ANSI_ESCAPE_AT_START = /^\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/;

/**
 * Truncate string to max length with indicator.
 *
 * ANSI escape codes are preserved so the client can render colored output, but a
 * naive slice can (a) cut across an escape sequence and (b) stop while a color or
 * style is still open. Either would bleed styling into the truncation notice and
 * anything the client renders afterwards. So we drop a dangling partial sequence
 * at the cut boundary and append a reset before the notice.
 */
export const truncateOutput = (str: string, maxLength: number = MAX_OUTPUT_LENGTH): string => {
  if (str.length <= maxLength) return str;

  let slice = str.slice(0, maxLength);

  // Drop a partial escape sequence left dangling at the cut boundary, otherwise
  // it would consume the leading characters of the truncation notice.
  const lastEsc = slice.lastIndexOf('\u001B');
  if (lastEsc !== -1 && !ANSI_ESCAPE_AT_START.test(slice.slice(lastEsc))) {
    slice = slice.slice(0, lastEsc);
  }

  // Reset any still-open SGR state so it cannot leak into the notice.
  const reset = slice.includes('\u001B') ? ANSI_RESET : '';

  return slice + reset + '\n... [truncated, ' + (str.length - maxLength) + ' more characters]';
};

/** Get cross-platform shell configuration */
export const getShellConfig = (command: string) =>
  process.platform === 'win32'
    ? { args: ['/c', command], cmd: 'cmd.exe' }
    : { args: ['-c', command], cmd: '/bin/sh' };
