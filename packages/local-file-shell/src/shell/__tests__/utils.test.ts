import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { expandEnvVars, getShellConfig, resetShellDetectionCache } from '../utils';

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

describe('expandEnvVars', () => {
  const env: NodeJS.ProcessEnv = {
    'HOME': '/home/tester',
    'PATH': 'C:\\Windows\\System32',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    'USERPROFILE': 'C:\\Users\\tester',
  };

  describe('PowerShell target (pwsh / powershell)', () => {
    it('should expand cmd style %VAR% (PowerShell cannot resolve it)', () => {
      expect(expandEnvVars('echo %USERPROFILE%', env, 'pwsh')).toBe('echo C:\\Users\\tester');
      expect(expandEnvVars('echo %USERPROFILE%', env, 'powershell')).toBe('echo C:\\Users\\tester');
    });

    it('should expand names containing parentheses like %ProgramFiles(x86)%', () => {
      expect(expandEnvVars('cd %ProgramFiles(x86)%', env, 'pwsh')).toBe(
        'cd C:\\Program Files (x86)',
      );
    });

    it('should match %VAR% names case-insensitively', () => {
      expect(expandEnvVars('echo %userprofile%', env, 'pwsh')).toBe('echo C:\\Users\\tester');
    });

    it('should leave unknown %VAR% untouched', () => {
      expect(expandEnvVars('echo %NOPE%', env, 'pwsh')).toBe('echo %NOPE%');
    });

    it('should leave native $env:VAR untouched (PowerShell resolves it itself)', () => {
      expect(expandEnvVars('echo $env:USERPROFILE', env, 'pwsh')).toBe('echo $env:USERPROFILE');
    });

    it('should not corrupt $env:VAR assignments', () => {
      const command = "$env:HTTP_PROXY='http://127.0.0.1:7890'; node app.js";
      expect(expandEnvVars(command, env, 'pwsh')).toBe(command);
    });

    it('should not corrupt PowerShell script variables colliding with env names', () => {
      // `$path` is a legitimate PowerShell local variable; it must not be
      // rewritten just because the PATH env var exists.
      const command = 'foreach ($path in Get-ChildItem) { Write-Output $path }';
      expect(expandEnvVars(command, env, 'pwsh')).toBe(command);
    });
  });

  describe('cmd target (fallback)', () => {
    it('should leave %VAR% untouched (cmd resolves it natively)', () => {
      expect(expandEnvVars('echo %USERPROFILE%', env, 'cmd')).toBe('echo %USERPROFILE%');
    });

    it('should expand PowerShell style $env:VAR', () => {
      expect(expandEnvVars('echo $env:USERPROFILE', env, 'cmd')).toBe('echo C:\\Users\\tester');
    });

    it('should expand bash style $VAR and ${VAR}', () => {
      expect(expandEnvVars('echo $HOME', env, 'cmd')).toBe('echo /home/tester');
      expect(expandEnvVars('echo ${HOME}/sub', env, 'cmd')).toBe('echo /home/tester/sub');
    });

    it('should leave unknown variables untouched', () => {
      expect(expandEnvVars('$env:NOPE $NOPE ${NOPE}', env, 'cmd')).toBe('$env:NOPE $NOPE ${NOPE}');
    });

    it('should match variable names case-insensitively', () => {
      expect(expandEnvVars('echo $env:UserProfile', env, 'cmd')).toBe('echo C:\\Users\\tester');
    });

    it('should not mistake $env:VAR for a bash $env variable', () => {
      // $env:USERPROFILE must expand to the value, not to "$env" + ":USERPROFILE".
      expect(expandEnvVars('$env:USERPROFILE', env, 'cmd')).toBe('C:\\Users\\tester');
    });

    it('should expand a mixed command string', () => {
      const command = 'copy $env:USERPROFILE\\a ${HOME}/b $HOME/c';
      expect(expandEnvVars(command, env, 'cmd')).toBe(
        'copy C:\\Users\\tester\\a /home/tester/b /home/tester/c',
      );
    });
  });
});
