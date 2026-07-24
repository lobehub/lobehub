import fs from 'node:fs';
import path from 'node:path';

/** Maximum preview bytes returned inline to prevent context explosion */
export const INLINE_OUTPUT_MAX_BYTES = 25 * 1024;

export interface OutputPreview {
  content: string;
  size: number;
  truncated: boolean;
}

// eslint-disable-next-line no-control-regex, regexp/no-obscure-range
const ANSI_ESCAPE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const stripAnsi = (str: string): string => str.replaceAll(ANSI_ESCAPE, '');

const formatBytes = (bytes: number): string => {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} bytes`;
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, '')}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1).replace(/\.0$/, '')}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1).replace(/\.0$/, '')}GB`;
};

export const buildOutputPreview = (
  filePath: string,
  headRatio: number,
  maxBytes = INLINE_OUTPUT_MAX_BYTES,
): OutputPreview => {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { content: '', size: 0, truncated: false };
  }

  const size = stat.size;
  if (size <= 0 || maxBytes <= 0) {
    return { content: '', size, truncated: false };
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    if (size <= maxBytes) {
      const buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, 0);
      return {
        content: stripAnsi(buffer.toString('utf8')),
        size,
        truncated: false,
      };
    }

    const normalizedHeadRatio = Math.min(Math.max(headRatio, 0), 1);
    const headBytes = Math.floor(maxBytes * normalizedHeadRatio);
    const tailBytes = Math.max(0, maxBytes - headBytes);
    const omittedBytes = Math.max(0, size - headBytes - tailBytes);

    if (headBytes <= 0) {
      const tail = Buffer.alloc(Math.min(maxBytes, size));
      fs.readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length));
      return {
        content: `... [showing last ${formatBytes(tail.length)} of ${formatBytes(size)}; full output saved to: ${filePath}]\n${stripAnsi(tail.toString('utf8'))}`,
        size,
        truncated: true,
      };
    }

    const head = Buffer.alloc(headBytes);
    const tail = Buffer.alloc(tailBytes);
    fs.readSync(fd, head, 0, headBytes, 0);
    fs.readSync(fd, tail, 0, tailBytes, Math.max(0, size - tailBytes));

    return {
      content: `${stripAnsi(head.toString('utf8'))}\n... [omitted ${formatBytes(omittedBytes)}; full output saved to: ${filePath}]\n${stripAnsi(tail.toString('utf8'))}`,
      size,
      truncated: true,
    };
  } finally {
    fs.closeSync(fd);
  }
};

/** Detected Windows shell flavour. */
export type WindowsShellType = 'pwsh' | 'powershell' | 'cmd';

export interface ShellInfo {
  /** Human-readable name surfaced to the model / UI, e.g. "PowerShell 7+ (pwsh)". */
  displayName: string;
  /** Absolute path to the shell executable used to spawn commands. */
  path: string;
  /** Shell flavour identifier. */
  type: WindowsShellType | 'sh';
}

/** Check whether an executable exists at the given absolute path. */
const executableExists = (candidate: string): boolean => {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
};

/**
 * Locate `pwsh.exe` (PowerShell 7+) by scanning `PATH` first, then the default
 * installation directory. Returns the absolute path or `undefined`.
 */
const findPwsh = (): string | undefined => {
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, 'pwsh.exe');
    if (executableExists(candidate)) return candidate;
  }

  // Default install location for PowerShell 7 when it is not on PATH.
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const defaultPwsh = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
  if (executableExists(defaultPwsh)) return defaultPwsh;

  return undefined;
};

/** Locate the built-in Windows PowerShell 5.1 (`powershell.exe`). */
const findWindowsPowerShell = (): string | undefined => {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidate = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return executableExists(candidate) ? candidate : undefined;
};

/**
 * Module-level cache for the Windows shell detection result. Detection touches
 * the filesystem, so we only run it once per process.
 */
type WindowsShellInfo = ShellInfo & { type: WindowsShellType };

let cachedWindowsShell: WindowsShellInfo | undefined;

/**
 * Reset the cached Windows shell detection result.
 *
 * @internal for tests only — production code should rely on the cache.
 */
export const resetShellDetectionCache = (): void => {
  cachedWindowsShell = undefined;
};

/**
 * Detect the preferred Windows shell, preferring PowerShell 7 (`pwsh`), then
 * Windows PowerShell 5.1 (`powershell`), and finally falling back to `cmd.exe`.
 * The result is cached for the lifetime of the process.
 */
export const detectWindowsShell = (): WindowsShellInfo => {
  if (cachedWindowsShell) return cachedWindowsShell;

  const pwshPath = findPwsh();
  if (pwshPath) {
    cachedWindowsShell = {
      displayName: 'PowerShell 7+ (pwsh)',
      path: pwshPath,
      type: 'pwsh',
    };
    return cachedWindowsShell;
  }

  const powershellPath = findWindowsPowerShell();
  if (powershellPath) {
    cachedWindowsShell = {
      displayName: 'Windows PowerShell 5.1',
      path: powershellPath,
      type: 'powershell',
    };
    return cachedWindowsShell;
  }

  // Extremely unlikely: neither PowerShell edition is present. Fall back to cmd.
  cachedWindowsShell = {
    displayName: 'cmd.exe',
    path: 'cmd.exe',
    type: 'cmd',
  };
  return cachedWindowsShell;
};

/**
 * Describe the shell that commands run in on the current platform. Used by the
 * desktop main process / CLI to tell the model which shell it is targeting.
 */
export const getShellInfo = (): ShellInfo =>
  process.platform === 'win32'
    ? detectWindowsShell()
    : { displayName: '/bin/sh', path: '/bin/sh', type: 'sh' };

/**
 * Rewrite environment variable references in a command string to the **target
 * shell's native syntax**, for the syntaxes that shell cannot resolve itself.
 * The value is never inlined — the spawned process receives `env`, so the shell
 * expands the reference from its own environment. Inlining raw values would
 * both break tokenization (values like `C:\Program Files (x86)` contain
 * spaces) and embed secrets passed via `env` into the child command line.
 *
 * - PowerShell target: only cmd-style `%VAR%` is rewritten (to `${env:VAR}`).
 *   `$env:VAR`, `$VAR` and `${VAR}` are valid PowerShell syntax that PowerShell
 *   resolves itself — rewriting them here would corrupt legitimate scripts (the
 *   `$env:FOO='bar'` assignment form, or script-local variables like
 *   `foreach ($path in ...)` colliding with the `PATH` env var).
 * - cmd target: PowerShell/bash forms (`$env:VAR`, `${VAR}`, `$VAR`) are
 *   rewritten to `%VAR%`; existing `%VAR%` is already cmd-native.
 *
 * Only variables present in `env` are rewritten; unknown references are left
 * untouched so the target shell can handle them. Windows variable names are
 * case-insensitive, so existence checks go through a lower-cased key set.
 */
export const normalizeEnvVarRefs = (
  command: string,
  env: NodeJS.ProcessEnv,
  shell: WindowsShellType,
): string => {
  // Windows env var names are case-insensitive; build a lower-cased key set.
  const envNames = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) envNames.add(key.toLowerCase());
  }

  if (shell === 'pwsh' || shell === 'powershell') {
    // cmd style: %VAR% — the name may contain parentheses, e.g. %ProgramFiles(x86)%.
    // `${env:VAR}` expands as a single token even when the value has spaces.
    return command.replaceAll(/%([A-Z_][\w()]*)%/gi, (match, name: string) =>
      envNames.has(name.toLowerCase()) ? `\${env:${name}}` : match,
    );
  }

  // cmd.exe target: rewrite to cmd-native %VAR%.
  const toCmdRef = (match: string, name: string): string =>
    envNames.has(name.toLowerCase()) ? `%${name}%` : match;

  // PowerShell style first: $env:VAR — rewritten before bash `$VAR` so the
  // `env:` prefix is consumed and never mistaken for a bash variable named `env`.
  let result = command.replaceAll(/\$env:([A-Z_]\w*)/gi, toCmdRef);
  // bash style: ${VAR}, then bare $VAR.
  result = result.replaceAll(/\$\{([A-Z_]\w*)\}/gi, toCmdRef);
  result = result.replaceAll(/\$([A-Z_]\w*)/gi, toCmdRef);
  return result;
};

/** Get cross-platform shell configuration */
export const getShellConfig = (command: string): { args: string[]; cmd: string } => {
  if (process.platform !== 'win32') {
    // macOS / Linux behaviour is intentionally unchanged.
    return { args: ['-c', command], cmd: '/bin/sh' };
  }

  const shell = detectWindowsShell();

  if (shell.type === 'pwsh' || shell.type === 'powershell') {
    // PowerShell collapses a native command's nonzero exit code to 1 unless the
    // script explicitly exits with $LASTEXITCODE (documented -Command /
    // -EncodedCommand behavior in both editions; verified against pwsh 7).
    // Append the same guard GitHub Actions' runner uses for pwsh steps so
    // native exit codes (e.g. `python -c "sys.exit(42)"`) propagate faithfully.
    // When no native command ran, $LASTEXITCODE is unset and PowerShell's own
    // exit status (0, or 1 on script failure) is preserved.
    const script = `${command}\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`;
    // Pass the command via -EncodedCommand (UTF-16LE base64) instead of a plain
    // argument. Node spawns processes without a shell, so the command string
    // would otherwise be re-tokenized by the Windows CRT / PowerShell's own
    // parser, which mangles quotes and backslashes in file paths. Encoding the
    // command sidesteps that tokenization entirely — the same approach used by
    // Ansible, VS Code Remote and Codex. See:
    // https://github.com/lobehub/lobehub/pull/14697
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return {
      args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      cmd: shell.path,
    };
  }

  // cmd.exe fallback (PowerShell not found): keep the legacy behaviour.
  return { args: ['/c', command], cmd: shell.path };
};
