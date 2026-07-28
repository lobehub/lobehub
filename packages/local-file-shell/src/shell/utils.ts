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
export type WindowsShellType = 'pwsh' | 'powershell' | 'cmd' | 'gitbash';

/**
 * User-facing Windows shell preference. `auto` runs the pwsh → PowerShell 5.1
 * → cmd detection chain; `gitbash` uses Git Bash when installed (falling back
 * to `auto` when it is not).
 */
export type WindowsShellPreference = 'auto' | 'gitbash';

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

/**
 * Locate Git Bash (`bash.exe` shipped with Git for Windows). Checks the
 * standard install locations first, then scans `PATH` — skipping `System32`,
 * whose `bash.exe` is the WSL launcher, not a Win32 bash.
 */
export const findGitBash = (): string | undefined => {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA;

  const standardCandidates = [
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    ...(localAppData ? [path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe')] : []),
  ];
  for (const candidate of standardCandidates) {
    if (executableExists(candidate)) return candidate;
  }

  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    if (/system32/i.test(dir)) continue;
    const candidate = path.join(dir, 'bash.exe');
    if (executableExists(candidate)) return candidate;
  }

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
 * Current user preference. Set by the desktop main process from its persisted
 * settings (see `setWindowsShellPreference`); defaults to automatic detection.
 */
let windowsShellPreference: WindowsShellPreference = 'auto';

/**
 * Reset the cached Windows shell detection result.
 *
 * @internal for tests only — production code should rely on the cache.
 */
export const resetShellDetectionCache = (): void => {
  cachedWindowsShell = undefined;
};

/**
 * Apply the user's Windows shell preference. Clears the detection cache so the
 * next command picks up the new shell immediately.
 */
export const setWindowsShellPreference = (preference: WindowsShellPreference): void => {
  if (windowsShellPreference === preference) return;
  windowsShellPreference = preference;
  cachedWindowsShell = undefined;
};

export const getWindowsShellPreference = (): WindowsShellPreference => windowsShellPreference;

/**
 * Detect the preferred Windows shell, preferring PowerShell 7 (`pwsh`), then
 * Windows PowerShell 5.1 (`powershell`), and finally falling back to `cmd.exe`.
 * The result is cached for the lifetime of the process.
 */
export const detectWindowsShell = (): WindowsShellInfo => {
  if (cachedWindowsShell) return cachedWindowsShell;

  // Explicit user preference first. When Git Bash was selected but is no
  // longer installed, silently fall back to the automatic chain instead of
  // failing every command.
  if (windowsShellPreference === 'gitbash') {
    const gitBashPath = findGitBash();
    if (gitBashPath) {
      cachedWindowsShell = {
        displayName: 'Git Bash',
        path: gitBashPath,
        type: 'gitbash',
      };
      return cachedWindowsShell;
    }
  }

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
 * - Git Bash target: cmd-style `%VAR%` and PowerShell-style `$env:VAR` are
 *   rewritten to `${VAR}`; `$VAR` / `${VAR}` are bash-native and untouched.
 *
 * Only variables present in `env` are rewritten; unknown references are left
 * untouched so the target shell can handle them. Windows variable names are
 * case-insensitive, so existence checks go through a lower-cased key set.
 */
export const normalizeEnvVarRefs = (
  command: string,
  // Structural type instead of NodeJS.ProcessEnv: app tsconfigs augment
  // ProcessEnv with required members, which would leak into this shared
  // package's API and break callers/tests that build plain env objects.
  env: Record<string, string | undefined>,
  shell: WindowsShellType,
): string => {
  // Windows env var names are case-insensitive; build a lower-cased key set
  // plus a map back to the actual key spelling for case-sensitive targets.
  const envNames = new Set<string>();
  const canonicalNames = new Map<string, string>();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    envNames.add(key.toLowerCase());
    canonicalNames.set(key.toLowerCase(), key);
  }

  if (shell === 'gitbash') {
    // Unlike cmd/PowerShell, bash resolves variables case-sensitively, so the
    // reference must be rewritten to the env key's actual spelling
    // (`%userprofile%` → `${USERPROFILE}`).
    const toBashRef = (match: string, name: string): string => {
      const canonical = canonicalNames.get(name.toLowerCase());
      return canonical === undefined ? match : `\${${canonical}}`;
    };
    // %VAR% — cmd style, bash cannot resolve it. Names containing parentheses
    // (e.g. %ProgramFiles(x86)%) are skipped: bash identifiers cannot contain
    // them, so a rewrite would produce a reference bash rejects.
    let result = command.replaceAll(/%([A-Z_][\w()]*)%/gi, (match, name: string) =>
      name.includes('(') ? match : toBashRef(match, name),
    );
    // $env:VAR — PowerShell style, bash would read it as `$env` + literal `:VAR`.
    result = result.replaceAll(/\$env:([A-Z_]\w*)/gi, toBashRef);
    return result;
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

  if (shell.type === 'gitbash') {
    // bash receives the command as a single argv entry; no CRT re-tokenization
    // problem applies (bash parses the string itself), so no encoding needed.
    return { args: ['-c', command], cmd: shell.path };
  }

  if (shell.type === 'pwsh' || shell.type === 'powershell') {
    // PowerShell collapses a native command's nonzero exit code to 1 unless the
    // script explicitly exits with $LASTEXITCODE (documented -Command /
    // -EncodedCommand behavior in both editions; verified against pwsh 7).
    // Append an exit guard that mirrors the `sh -c` / `cmd /c` convention: the
    // *final* statement decides. `$?` is captured first (assignments don't
    // reset it); only when it is false do we exit nonzero — preferring the
    // faithful native code (e.g. `python -c "sys.exit(42)"` → 42) and falling
    // back to 1 for cmdlet failures. A stale nonzero $LASTEXITCODE from an
    // intentionally-ignored earlier failure (`git diff --exit-code; cleanup`)
    // must NOT override a successful final statement, and a trailing cmdlet
    // failure must NOT be masked by a successful native command's 0.
    // All branches verified empirically on pwsh 7 via -EncodedCommand.
    const exitGuard =
      '\n$__lobeExecOk = $?' +
      '\nif (-not $__lobeExecOk) {' +
      '\n  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }' +
      '\n  exit 1' +
      '\n}';
    const script = `${command}${exitGuard}`;
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
