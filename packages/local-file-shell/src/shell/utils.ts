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
    // command-line tokenization and CRT argv parsing.
    // PowerShell decodes -EncodedCommand internally -- no quoting issues.
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    return {
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      cmd: 'powershell.exe',
    };
  }
  return { args: ['-c', command], cmd: '/bin/sh' };
};

/**
 * Safely quote a string literal for the target shell so that the value
 * is always treated as data, never as code.
 *
 * PowerShell: single-quote wrap; internal single quotes are doubled.
 *   e.g.  it's fine  ->  'it''s fine'
 *
 * POSIX sh:  single-quote wrap with '\'' for embedded single quotes.
 *   e.g.  it's fine  ->  'it'\''s fine'
 *
 * Single-quoted strings in both shells are fully literal: variable
 * references, subexpressions and backticks are NOT interpreted.
 */
const quoteForShell = (value: string, platform: NodeJS.Platform): string => {
  if (platform === 'win32') {
    // PowerShell: '' to escape a single quote inside '...'
    return `'${value.replace(/'/g, "''")}'`;
  }
  // POSIX sh: end quote, escaped single quote, restart quote
  return `'${value.replace(/'/g, "'\\''")}'`;
};

/**
 * Pre-expand %VAR% (Windows/cmd-style) references in a command string.
 *
 * SECURITY DESIGN
 * ---------------
 * Only %VAR% is expanded here. The other syntaxes ($VAR, ${VAR}, $env:VAR)
 * are left untouched and handled by the target shell natively:
 *
 *   - POSIX /bin/sh expands $VAR/${VAR} without recursive evaluation of the
 *     value, so a value like "$(rm -rf /)" is treated as a literal string.
 *   - PowerShell expands $env:VAR natively after -EncodedCommand decodes the
 *     script; single-quoted literals are never evaluated.
 *
 * Pre-expanding those syntaxes in Node would substitute the raw value into
 * the command string *before* the shell sees it, turning data into code and
 * enabling injection attacks.
 *
 * %VAR% is never expanded natively by PowerShell or sh, so Node must handle
 * it for cross-platform compatibility. The substituted value is always
 * single-quoted (via quoteForShell) so metacharacters in the value cannot
 * be interpreted as shell syntax.
 *
 * KNOWN LIMITATION
 * ----------------
 * If a command string already wraps %VAR% inside quotes
 * (e.g. Write-Output "%FOO%"), the substitution adds an extra layer of
 * single quotes. This is intentional -- safety over cosmetics -- and should
 * be treated as a follow-up if raw substitution is needed for a specific
 * use case.
 *
 * @param command  The raw command string.
 * @param env      Environment to read from (default: process.env). Pass the
 *                 merged child env so that extraEnv overrides are visible.
 * @param platform Target platform for shell-aware quoting (default: process.platform).
 */
export const expandEnvVars = (
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string =>
  command.replace(/%([^%]+)%/g, (match, name) => {
    const val = env[name];
    return val === undefined ? match : quoteForShell(String(val), platform);
  });

/**
 * Returns true when running on Windows.
 */
export const isWindows = (): boolean => process.platform === 'win32';
