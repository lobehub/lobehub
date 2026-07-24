import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getShellConfig, normalizeEnvVarRefs, resetShellDetectionCache } from '../utils';

/** Restore process.platform to its real value after tampering in a test. */
const realPlatform = process.platform;

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
};

const restorePlatform = () => {
  Object.defineProperty(process, 'platform', { configurable: true, value: realPlatform });
};

/** Decode an -EncodedCommand base64 (UTF-16LE) argument back to the original string. */
const decodeEncodedCommand = (encoded: string): string =>
  Buffer.from(encoded, 'base64').toString('utf16le');

describe('getShellConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restorePlatform();
    resetShellDetectionCache();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('should return shell config for the current platform (regression)', () => {
    const config = getShellConfig('echo hello');

    if (process.platform === 'win32') {
      // Actual assertions for win32 are covered by the dedicated cases below.
      expect(config.cmd).toBeTruthy();
    } else {
      expect(config.cmd).toBe('/bin/sh');
      expect(config.args).toEqual(['-c', 'echo hello']);
    }
  });

  it('should keep /bin/sh -c behavior on darwin', () => {
    setPlatform('darwin');
    const config = getShellConfig('echo hello');
    expect(config.cmd).toBe('/bin/sh');
    expect(config.args).toEqual(['-c', 'echo hello']);
  });

  it('should keep /bin/sh -c behavior on linux', () => {
    setPlatform('linux');
    const config = getShellConfig('ls -la');
    expect(config.cmd).toBe('/bin/sh');
    expect(config.args).toEqual(['-c', 'ls -la']);
  });

  it('should use pwsh with -EncodedCommand when pwsh.exe is on PATH', () => {
    setPlatform('win32');
    // NB: use a delimiter-safe fake dir. On the CI/dev host the default `path`
    // module is POSIX, so PATH is split on ':'; a real 'C:\\...' entry would be
    // torn apart. This still exercises the PATH-scan + join + encode logic.
    const pwshDir = '/fake/tools/pwsh';
    const pwshPath = path.join(pwshDir, 'pwsh.exe');
    process.env.PATH = pwshDir;
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === pwshPath);

    const config = getShellConfig('Get-ChildItem "C:\\Program Files"');

    expect(config.cmd).toBe(pwshPath);
    expect(config.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(decodeEncodedCommand(config.args[3])).toBe('Get-ChildItem "C:\\Program Files"');
  });

  it('should fall back to Windows PowerShell 5.1 when only powershell.exe exists', () => {
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
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === powershellPath);

    const config = getShellConfig('echo hi');

    expect(config.cmd).toBe(powershellPath);
    expect(config.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(decodeEncodedCommand(config.args[3])).toBe('echo hi');
  });

  it('should fall back to cmd.exe /c when neither PowerShell edition exists', () => {
    setPlatform('win32');
    process.env.PATH = 'C:\\Tools';
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const config = getShellConfig('dir');

    expect(config.cmd).toBe('cmd.exe');
    expect(config.args).toEqual(['/c', 'dir']);
  });

  it('should cache the detection result across calls', () => {
    setPlatform('win32');
    const pwshDir = '/fake/tools/pwsh';
    const pwshPath = path.join(pwshDir, 'pwsh.exe');
    process.env.PATH = pwshDir;
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === pwshPath);

    getShellConfig('echo one');
    const callsAfterFirst = existsSpy.mock.calls.length;
    getShellConfig('echo two');

    expect(callsAfterFirst).toBeGreaterThan(0);
    // Second call must not touch the filesystem again.
    expect(existsSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('should find pwsh at the default install path when not on PATH', () => {
    setPlatform('win32');
    process.env.PATH = 'C:\\Tools';
    process.env.ProgramFiles = 'C:\\Program Files';
    const defaultPwsh = path.join('C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === defaultPwsh);

    const config = getShellConfig('echo hi');

    expect(config.cmd).toBe(defaultPwsh);
  });
});

describe('normalizeEnvVarRefs', () => {
  const env: NodeJS.ProcessEnv = {
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
