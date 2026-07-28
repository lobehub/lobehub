import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findGitBash,
  getShellConfig,
  normalizeEnvVarRefs,
  resetShellDetectionCache,
  setWindowsShellPreference,
} from '../utils';

/** Restore process.platform to its real value after tampering in a test. */
const realPlatform = process.platform;

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
};

const restorePlatform = () => {
  Object.defineProperty(process, 'platform', { configurable: true, value: realPlatform });
};

/**
 * Mock the async lstat probe used by executableExists so that only the given
 * paths are reported as existing.
 */
const mockExisting = (...existing: string[]) =>
  vi.spyOn(fs.promises, 'lstat').mockImplementation(async (p) => {
    if (existing.includes(p.toString())) return {} as fs.Stats;
    throw new Error('ENOENT');
  });

/** Decode an -EncodedCommand base64 (UTF-16LE) argument back to the original string. */
const decodeEncodedCommand = (encoded: string): string =>
  Buffer.from(encoded, 'base64').toString('utf16le');

/**
 * Guard appended to every PowerShell script so the final statement decides the
 * exit code (`sh -c` / `cmd /c` convention): failing native commands propagate
 * their real exit code instead of collapsing to 1, trailing cmdlet failures
 * exit 1, and a stale $LASTEXITCODE never overrides a successful final
 * statement (see getShellConfig).
 */
/** UTF-8 console setup prepended to every PowerShell script (see getShellConfig). */
const ENCODING_PREAMBLE =
  'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}' +
  '\n$OutputEncoding = [System.Text.Encoding]::UTF8\n';

const EXIT_CODE_GUARD =
  '\n$__lobeExecOk = $?' +
  '\nif (-not $__lobeExecOk) {' +
  '\n  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }' +
  '\n  exit 1' +
  '\n}';

describe('getShellConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restorePlatform();
    resetShellDetectionCache();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('should return shell config for the current platform (regression)', async () => {
    const config = await getShellConfig('echo hello');

    if (process.platform === 'win32') {
      // Actual assertions for win32 are covered by the dedicated cases below.
      expect(config.cmd).toBeTruthy();
    } else {
      expect(config.cmd).toBe('/bin/sh');
      expect(config.args).toEqual(['-c', 'echo hello']);
    }
  });

  it('should keep /bin/sh -c behavior on darwin', async () => {
    setPlatform('darwin');
    const config = await getShellConfig('echo hello');
    expect(config.cmd).toBe('/bin/sh');
    expect(config.args).toEqual(['-c', 'echo hello']);
  });

  it('should keep /bin/sh -c behavior on linux', async () => {
    setPlatform('linux');
    const config = await getShellConfig('ls -la');
    expect(config.cmd).toBe('/bin/sh');
    expect(config.args).toEqual(['-c', 'ls -la']);
  });

  it('should use pwsh with -EncodedCommand when pwsh.exe is on PATH', async () => {
    setPlatform('win32');
    // NB: use a delimiter-safe fake dir. On the CI/dev host the default `path`
    // module is POSIX, so PATH is split on ':'; a real 'C:\\...' entry would be
    // torn apart. This still exercises the PATH-scan + join + encode logic.
    const pwshDir = '/fake/tools/pwsh';
    const pwshPath = path.join(pwshDir, 'pwsh.exe');
    process.env.PATH = pwshDir;
    mockExisting(pwshPath);

    const config = await getShellConfig('Get-ChildItem "C:\\Program Files"');

    expect(config.cmd).toBe(pwshPath);
    expect(config.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(decodeEncodedCommand(config.args[3])).toBe(
      `${ENCODING_PREAMBLE}Get-ChildItem "C:\\Program Files"${EXIT_CODE_GUARD}`,
    );
  });

  it('should fall back to Windows PowerShell 5.1 when only powershell.exe exists', async () => {
    setPlatform('win32');
    process.env.PATH = 'C:\\Tools';
    process.env.SystemRoot = 'C:\\Windows';
    const powershellPath = path.join(
      'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    mockExisting(powershellPath);

    const config = await getShellConfig('echo hi');

    expect(config.cmd).toBe(powershellPath);
    expect(config.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(decodeEncodedCommand(config.args[3])).toBe(
      `${ENCODING_PREAMBLE}echo hi${EXIT_CODE_GUARD}`,
    );
  });

  it('should fall back to cmd.exe /c when neither PowerShell edition exists', async () => {
    setPlatform('win32');
    process.env.PATH = 'C:\\Tools';
    mockExisting();

    const config = await getShellConfig('dir');

    expect(config.cmd).toBe('cmd.exe');
    expect(config.args).toEqual(['/c', 'dir']);
  });

  it('should cache the detection result across calls', async () => {
    setPlatform('win32');
    const pwshDir = '/fake/tools/pwsh';
    const pwshPath = path.join(pwshDir, 'pwsh.exe');
    process.env.PATH = pwshDir;
    const lstatSpy = mockExisting(pwshPath);

    await getShellConfig('echo one');
    const callsAfterFirst = lstatSpy.mock.calls.length;
    await getShellConfig('echo two');

    expect(callsAfterFirst).toBeGreaterThan(0);
    // Second call must not touch the filesystem again.
    expect(lstatSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('should share a single detection run between concurrent first calls', async () => {
    setPlatform('win32');
    const pwshDir = '/fake/tools/pwsh';
    const pwshPath = path.join(pwshDir, 'pwsh.exe');
    process.env.PATH = pwshDir;
    const lstatSpy = mockExisting(pwshPath);

    // Both calls start before either resolves — the promise cache must
    // deduplicate them into one filesystem scan.
    const [first, second] = await Promise.all([
      getShellConfig('echo one'),
      getShellConfig('echo two'),
    ]);
    const callsAfterBoth = lstatSpy.mock.calls.length;

    expect(first.cmd).toBe(pwshPath);
    expect(second.cmd).toBe(pwshPath);
    await getShellConfig('echo three');
    expect(lstatSpy.mock.calls.length).toBe(callsAfterBoth);
  });

  it('should find pwsh at the default install path when not on PATH', async () => {
    setPlatform('win32');
    process.env.PATH = 'C:\\Tools';
    process.env.ProgramFiles = 'C:\\Program Files';
    const defaultPwsh = path.join('C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
    mockExisting(defaultPwsh);

    const config = await getShellConfig('echo hi');

    expect(config.cmd).toBe(defaultPwsh);
  });

  it('should find MS Store pwsh via its app-execution alias', async () => {
    setPlatform('win32');
    process.env.PATH = 'C:\\Tools';
    process.env.LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local';
    // App-execution aliases are zero-byte reparse points, which is why the
    // existence probe uses lstat (stat may fail to resolve the target).
    const aliasPwsh = path.join(
      'C:\\Users\\tester\\AppData\\Local',
      'Microsoft',
      'WindowsApps',
      'pwsh.exe',
    );
    mockExisting(aliasPwsh);

    const config = await getShellConfig('echo hi');

    expect(config.cmd).toBe(aliasPwsh);
  });
});

describe('normalizeEnvVarRefs', () => {
  const env: Record<string, string | undefined> = {
    'HOME': '/home/tester',
    'PATH': 'C:\\Windows\\System32',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    'TOKEN': 'secret value & echo pwned',
    'USERPROFILE': 'C:\\Users\\tester',
  };

  describe('PowerShell target (pwsh / powershell)', () => {
    it('should rewrite cmd style %VAR% to ${env:VAR} (PowerShell cannot resolve %VAR%)', () => {
      expect(normalizeEnvVarRefs('echo %USERPROFILE%', env, 'pwsh')).toBe(
        'echo ${env:USERPROFILE}',
      );
      expect(normalizeEnvVarRefs('echo %USERPROFILE%', env, 'powershell')).toBe(
        'echo ${env:USERPROFILE}',
      );
    });

    it('should rewrite names containing parentheses like %ProgramFiles(x86)%', () => {
      // Rewriting (not pasting the raw value) matters here: the value contains
      // spaces and would be split into multiple arguments by PowerShell.
      expect(normalizeEnvVarRefs('cd %ProgramFiles(x86)%', env, 'pwsh')).toBe(
        'cd ${env:ProgramFiles(x86)}',
      );
    });

    it('should match %VAR% names case-insensitively', () => {
      expect(normalizeEnvVarRefs('echo %userprofile%', env, 'pwsh')).toBe(
        'echo ${env:userprofile}',
      );
    });

    it('should leave unknown %VAR% untouched', () => {
      expect(normalizeEnvVarRefs('echo %NOPE%', env, 'pwsh')).toBe('echo %NOPE%');
    });

    it('should leave native $env:VAR untouched (PowerShell resolves it itself)', () => {
      expect(normalizeEnvVarRefs('echo $env:USERPROFILE', env, 'pwsh')).toBe(
        'echo $env:USERPROFILE',
      );
    });

    it('should not corrupt $env:VAR assignments', () => {
      const command = "$env:HTTP_PROXY='http://127.0.0.1:7890'; node app.js";
      expect(normalizeEnvVarRefs(command, env, 'pwsh')).toBe(command);
    });

    it('should not corrupt PowerShell script variables colliding with env names', () => {
      // `$path` is a legitimate PowerShell local variable; it must not be
      // rewritten just because the PATH env var exists.
      const command = 'foreach ($path in Get-ChildItem) { Write-Output $path }';
      expect(normalizeEnvVarRefs(command, env, 'pwsh')).toBe(command);
    });
  });

  describe('cmd target (fallback)', () => {
    it('should leave %VAR% untouched (cmd resolves it natively)', () => {
      expect(normalizeEnvVarRefs('echo %USERPROFILE%', env, 'cmd')).toBe('echo %USERPROFILE%');
    });

    it('should rewrite PowerShell style $env:VAR to %VAR%', () => {
      expect(normalizeEnvVarRefs('echo $env:USERPROFILE', env, 'cmd')).toBe('echo %USERPROFILE%');
    });

    it('should rewrite bash style $VAR and ${VAR} to %VAR%', () => {
      expect(normalizeEnvVarRefs('echo $HOME', env, 'cmd')).toBe('echo %HOME%');
      expect(normalizeEnvVarRefs('echo ${HOME}/sub', env, 'cmd')).toBe('echo %HOME%/sub');
    });

    it('should never inline values (secrets with cmd metacharacters stay as references)', () => {
      // Inlining the raw value would inject `& echo pwned` into the command line.
      expect(normalizeEnvVarRefs('deploy --token $env:TOKEN', env, 'cmd')).toBe(
        'deploy --token %TOKEN%',
      );
    });

    it('should leave unknown variables untouched', () => {
      expect(normalizeEnvVarRefs('$env:NOPE $NOPE ${NOPE}', env, 'cmd')).toBe(
        '$env:NOPE $NOPE ${NOPE}',
      );
    });

    it('should match variable names case-insensitively', () => {
      expect(normalizeEnvVarRefs('echo $env:UserProfile', env, 'cmd')).toBe('echo %UserProfile%');
    });

    it('should not mistake $env:VAR for a bash $env variable', () => {
      // $env:USERPROFILE must become %USERPROFILE%, not "$env" + ":USERPROFILE".
      expect(normalizeEnvVarRefs('$env:USERPROFILE', env, 'cmd')).toBe('%USERPROFILE%');
    });

    it('should rewrite a mixed command string', () => {
      const command = 'copy $env:USERPROFILE\\a ${HOME}/b $HOME/c';
      expect(normalizeEnvVarRefs(command, env, 'cmd')).toBe(
        'copy %USERPROFILE%\\a %HOME%/b %HOME%/c',
      );
    });
  });
});

describe('Git Bash preference', () => {
  const originalEnv = { ...process.env };
  const gitBashPath = path.join('C:\\Program Files', 'Git', 'bin', 'bash.exe');

  afterEach(() => {
    restorePlatform();
    setWindowsShellPreference('auto');
    resetShellDetectionCache();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('should use bash -c when the user selected Git Bash and it is installed', async () => {
    setPlatform('win32');
    process.env.ProgramFiles = 'C:\\Program Files';
    mockExisting(gitBashPath);
    setWindowsShellPreference('gitbash');

    const config = await getShellConfig('echo "hello world"');

    expect(config.cmd).toBe(gitBashPath);
    expect(config.args).toEqual(['-c', 'echo "hello world"']);
  });

  it('should fall back to the automatic chain when Git Bash is selected but missing', async () => {
    setPlatform('win32');
    const pwshDir = '/fake/tools/pwsh';
    const pwshPath = path.join(pwshDir, 'pwsh.exe');
    process.env.PATH = pwshDir;
    mockExisting(pwshPath);
    setWindowsShellPreference('gitbash');

    const config = await getShellConfig('echo hi');

    expect(config.cmd).toBe(pwshPath);
  });

  it('should skip System32 bash.exe (WSL launcher) during PATH scan', async () => {
    setPlatform('win32');
    const system32Bash = path.join('C:\\Windows\\System32', 'bash.exe');
    process.env.PATH = 'C:\\Windows\\System32';
    delete process.env.ProgramFiles;
    delete process.env['ProgramFiles(x86)'];
    delete process.env.LOCALAPPDATA;
    mockExisting(system32Bash);

    await expect(findGitBash()).resolves.toBeUndefined();
  });

  it('should re-run detection after the preference changes', async () => {
    setPlatform('win32');
    const pwshDir = '/fake/tools/pwsh';
    const pwshPath = path.join(pwshDir, 'pwsh.exe');
    process.env.PATH = pwshDir;
    process.env.ProgramFiles = 'C:\\Program Files';
    mockExisting(pwshPath, gitBashPath);

    expect((await getShellConfig('echo one')).cmd).toBe(pwshPath);
    setWindowsShellPreference('gitbash');
    expect((await getShellConfig('echo two')).cmd).toBe(gitBashPath);
  });
});

describe('normalizeEnvVarRefs (gitbash target)', () => {
  const env: Record<string, string | undefined> = {
    'HOME': '/home/tester',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    'USERPROFILE': 'C:\\Users\\tester',
  };

  it('should rewrite cmd style %VAR% to ${VAR}', () => {
    expect(normalizeEnvVarRefs('cd %USERPROFILE%', env, 'gitbash')).toBe('cd ${USERPROFILE}');
  });

  it('should rewrite to the canonical env key spelling (bash is case-sensitive)', () => {
    expect(normalizeEnvVarRefs('cd %userprofile%', env, 'gitbash')).toBe('cd ${USERPROFILE}');
    expect(normalizeEnvVarRefs('echo $env:home', env, 'gitbash')).toBe('echo ${HOME}');
  });

  it('should rewrite PowerShell style $env:VAR to ${VAR}', () => {
    expect(normalizeEnvVarRefs('echo $env:USERPROFILE', env, 'gitbash')).toBe(
      'echo ${USERPROFILE}',
    );
  });

  it('should leave bash-native $VAR and ${VAR} untouched', () => {
    expect(normalizeEnvVarRefs('echo $HOME ${HOME}', env, 'gitbash')).toBe('echo $HOME ${HOME}');
  });

  it('should emit an upper-case fallback for mixed-case names (MSYS2 upper-cases some vars)', () => {
    const mixedEnv = { ...env, ProgramFiles: 'C:\\Program Files' };
    // Inside Git Bash the variable is spelled PROGRAMFILES (MSYS2 upper-cases
    // it on import), so a plain ${ProgramFiles} would expand to empty.
    expect(normalizeEnvVarRefs('ls "%ProgramFiles%"', mixedEnv, 'gitbash')).toBe(
      'ls "${ProgramFiles:-${PROGRAMFILES}}"',
    );
    expect(normalizeEnvVarRefs('echo $env:programfiles', mixedEnv, 'gitbash')).toBe(
      'echo ${ProgramFiles:-${PROGRAMFILES}}',
    );
  });

  it('should leave names containing parentheses untouched (invalid bash identifiers)', () => {
    expect(normalizeEnvVarRefs('dir "%ProgramFiles(x86)%"', env, 'gitbash')).toBe(
      'dir "%ProgramFiles(x86)%"',
    );
  });

  it('should leave unknown variables untouched', () => {
    expect(normalizeEnvVarRefs('echo %NOPE% $env:NOPE', env, 'gitbash')).toBe(
      'echo %NOPE% $env:NOPE',
    );
  });
});

describe('findGitBash package-manager installs', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restorePlatform();
    resetShellDetectionCache();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('should find bash under the default scoop root', async () => {
    setPlatform('win32');
    delete process.env.ProgramFiles;
    delete process.env['ProgramFiles(x86)'];
    delete process.env.LOCALAPPDATA;
    delete process.env.SCOOP;
    process.env.USERPROFILE = '/fake/home';
    process.env.PATH = '';
    const scoopBash = path.resolve(
      '/fake/home',
      'scoop',
      'apps',
      'git',
      'current',
      'bin',
      'bash.exe',
    );
    mockExisting(scoopBash);

    await expect(findGitBash()).resolves.toBe(scoopBash);
  });

  it('should honor a custom SCOOP root', async () => {
    setPlatform('win32');
    delete process.env.ProgramFiles;
    delete process.env['ProgramFiles(x86)'];
    delete process.env.LOCALAPPDATA;
    delete process.env.USERPROFILE;
    process.env.SCOOP = '/fake/scoop-root';
    process.env.PATH = '';
    const scoopBash = path.resolve('/fake/scoop-root', 'apps', 'git', 'current', 'bin', 'bash.exe');
    mockExisting(scoopBash);

    await expect(findGitBash()).resolves.toBe(scoopBash);
  });

  it('should derive bash from git.exe on PATH when bash itself is not shimmed', async () => {
    setPlatform('win32');
    delete process.env.ProgramFiles;
    delete process.env['ProgramFiles(x86)'];
    delete process.env.LOCALAPPDATA;
    delete process.env.SCOOP;
    delete process.env.USERPROFILE;
    const gitCmdDir = '/fake/custom-git/cmd';
    process.env.PATH = gitCmdDir;
    const gitExe = path.join(gitCmdDir, 'git.exe');
    const siblingBash = path.resolve(gitCmdDir, '..', 'bin', 'bash.exe');
    mockExisting(gitExe, siblingBash);

    await expect(findGitBash()).resolves.toBe(siblingBash);
  });
});
