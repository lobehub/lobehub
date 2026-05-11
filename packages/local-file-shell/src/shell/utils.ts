/** Maximum output length to prevent context explosion */
export const MAX_OUTPUT_LENGTH = 80_000;

/** Strip ANSI escape codes from terminal output */
// eslint-disable-next-line no-control-regex, regexp/no-obscure-range
const ANSI_REGEX = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export const stripAnsi = (str: string): string => str.replaceAll(ANSI_REGEX, '');

/** Truncate string to max length with indicator */
export const truncateOutput = (str: string, maxLength: number = MAX_OUTPUT_LENGTH): string => {
  const cleaned = stripAnsi(str);
  if (cleaned.length <= maxLength) return cleaned;
  return (
    cleaned.slice(0, maxLength) +
    '\n... [truncated, ' +
    (cleaned.length - maxLength) +
    ' more characters]'
  );
};

/** Get cross-platform shell configuration */
export const getShellConfig = (command: string) => {
  if (process.platform === 'win32') {
    // Encode as UTF-16LE -> Base64 to completely bypass Windows
    // command-line tokenization and CRT argv[] parsing.
    // PowerShell decodes -EncodedCommand internally — no quoting issues,
    // no backslash escape ambiguity, no space-in-path splitting.
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    return {
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      cmd: 'powershell.exe',
    };
  }
  return { args: ['-c', command], cmd: '/bin/sh' };
};


/**
 * Pre-expand environment variable references in a command string using
 * Node.js process.env - shell-agnostic and cross-platform.
 *
 * Handles all three common syntaxes:
 *   %VAR%         -> Windows cmd style
 *   $env:VAR      -> PowerShell style
 *   $VAR / ${VAR} -> Unix bash/sh style
 *
 * Unknown variables are left as-is (no substitution).
 */
export const expandEnvVars = (command: string): string => {
  const replace = (name: string, original: string): string =>
    process.env[name] ?? original;

  // %VAR% - Windows cmd
  let result = command.replace(/%([^%]+)%/g, (match, name) => replace(name, match));
  // $env:VAR - PowerShell
  result = result.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => replace(name, match));
  // ${VAR} - Unix braced
  result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => replace(name, match));
  // $VAR - Unix unbraced (uppercase + underscore only to avoid false positives)
  result = result.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, name) => replace(name, match));
  return result;
};
