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
export const getShellConfig = (command: string) =>
  process.platform === 'win32'
    ? // Use PowerShell on Windows: supports &&, ||, pipes, $env:, and all modern shell features.
      // cmd.exe /c breaks on &&, complex pipes and quoted paths even with windowsVerbatimArguments.
      { args: ['-NoProfile', '-NonInteractive', '-Command', command], cmd: 'powershell.exe' }
    : { args: ['-c', command], cmd: '/bin/sh' };

/**
 * Pre-expand environment variable references in a command string using
 * Node.js process.env - shell-agnostic and cross-platform.
 *
 * Handles all three common syntaxes so commands work regardless of which
 * shell eventually executes them:
 *   %VAR%         -> Windows cmd style
 *   $env:VAR      -> PowerShell style
 *   $VAR / ${VAR} -> Unix bash/sh style
 *
 * Windows paths (containing backslashes) are wrapped in single quotes
 * so the shell receives a safe literal string regardless of quoting.
 * Unknown variables are left as-is.
 */
export const expandEnvVars = (command: string): string => {
  const replace = (name: string, original: string): string => {
    const val = process.env[name];
    if (val === undefined) return original;
    // Wrap Windows paths in single quotes to prevent shell misinterpretation
    // of unquoted backslash sequences after variable expansion.
    return val.includes('\\') ? `'${val}'` : val;
  };

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

/**
 * Returns true when running on Windows - used to gate windowsVerbatimArguments
 * and other platform-specific spawn options.
 */
export const isWindows = (): boolean => process.platform === 'win32';
