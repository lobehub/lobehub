import { execFile } from 'node:child_process';

import { detectWindowsShell } from '@lobechat/local-file-shell/shell';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshShellEnvironment } from './shellPath';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('@lobechat/local-file-shell/shell', () => ({ detectWindowsShell: vi.fn() }));

const execFileMock = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;
const detectWindowsShellMock = vi.mocked(detectWindowsShell);

describe('refreshShellEnvironment', () => {
  const originalPlatform = process.platform;
  const originalPath = process.env.PATH;
  const originalShell = process.env.SHELL;
  const originalAwsBearerTokenBedrock = process.env.AWS_BEARER_TOKEN_BEDROCK;
  const originalAwsProfile = process.env.AWS_PROFILE;
  const originalClaudeCodeUseBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
  const originalShellFixture = process.env.AWS_LOBEHUB_SHELL_FIXTURE;
  const originalUnrelatedSecret = process.env.UNRELATED_SECRET;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    process.env.PATH = '/usr/bin:/bin';
    process.env.SHELL = '/bin/zsh';
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_LOBEHUB_SHELL_FIXTURE;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.UNRELATED_SECRET;
    execFileMock.mockReset();
    detectWindowsShellMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
    if (originalAwsBearerTokenBedrock === undefined) delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    else process.env.AWS_BEARER_TOKEN_BEDROCK = originalAwsBearerTokenBedrock;
    if (originalAwsProfile === undefined) delete process.env.AWS_PROFILE;
    else process.env.AWS_PROFILE = originalAwsProfile;
    if (originalShellFixture === undefined) delete process.env.AWS_LOBEHUB_SHELL_FIXTURE;
    else process.env.AWS_LOBEHUB_SHELL_FIXTURE = originalShellFixture;
    if (originalClaudeCodeUseBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
    else process.env.CLAUDE_CODE_USE_BEDROCK = originalClaudeCodeUseBedrock;
    if (originalUnrelatedSecret === undefined) delete process.env.UNRELATED_SECRET;
    else process.env.UNRELATED_SECRET = originalUnrelatedSecret;
  });

  it('updates PATH from the login shell output', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(
        null,
        'shell startup output\n__LOBE_SHELL_PATH__/opt/homebrew/bin:/usr/bin__LOBE_SHELL_PATH__',
        '',
      );
    });

    await refreshShellEnvironment();

    expect(process.env.PATH).toBe('/opt/homebrew/bin:/usr/bin');
    expect(execFileMock).toHaveBeenCalledWith(
      '/bin/zsh',
      expect.arrayContaining(['-ilc']),
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
    const shellScript = execFileMock.mock.calls[0][1][1];
    expect(shellScript).not.toContain('env -0');
    expect(shellScript).not.toMatch(/;\s*exit\b/);
  });

  it('imports Claude Code Bedrock settings from the login shell', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(
        null,
        [
          'shell startup output',
          '__LOBE_SHELL_PATH__/opt/homebrew/bin:/usr/bin__LOBE_SHELL_PATH__',
          '__LOBE_SHELL_ENV__AWS_BEARER_TOKEN_BEDROCK=bedrock-token',
          '__LOBE_SHELL_ENV__AWS_PROFILE=bedrock-dev',
          '__LOBE_SHELL_ENV__CLAUDE_CODE_USE_BEDROCK=1',
          '__LOBE_SHELL_ENV__UNRELATED_SECRET=do-not-import',
        ].join('\n'),
        '',
      );
    });

    await refreshShellEnvironment();

    expect(process.env.AWS_BEARER_TOKEN_BEDROCK).toBe('bedrock-token');
    expect(process.env.AWS_PROFILE).toBe('bedrock-dev');
    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(process.env.UNRELATED_SECRET).toBeUndefined();
  });

  it.skipIf(originalPlatform === 'win32')(
    'reads Bedrock settings through the real platform env command',
    async () => {
      const { execFile: actualExecFile } = (await vi.importActual('node:child_process')) as {
        execFile: typeof execFile;
      };
      process.env.SHELL = '/bin/sh';
      process.env.AWS_LOBEHUB_SHELL_FIXTURE = 'fixture-value';
      process.env.UNRELATED_SECRET = 'must-not-import';
      execFileMock.mockImplementation((file, args, options, callback) => {
        delete process.env.AWS_LOBEHUB_SHELL_FIXTURE;
        delete process.env.UNRELATED_SECRET;
        return actualExecFile(file, args, options, callback);
      });

      await refreshShellEnvironment();

      expect(process.env.AWS_LOBEHUB_SHELL_FIXTURE).toBe('fixture-value');
      expect(process.env.UNRELATED_SECRET).toBeUndefined();
    },
  );

  it('imports Bedrock settings from the Windows user environment and PowerShell Profile', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    detectWindowsShellMock.mockResolvedValue({
      displayName: 'PowerShell 7+ (pwsh)',
      path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      type: 'pwsh',
    });
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(
        null,
        [
          'PowerShell profile output',
          '__LOBE_SHELL_ENV__',
          '{"AWS_BEARER_TOKEN_BEDROCK":"bedrock-token","AWS_REGION":"us-east-1","CLAUDE_CODE_USE_BEDROCK":"1","UNRELATED_SECRET":"do-not-import"}',
          '__LOBE_SHELL_ENV__',
        ].join('\r\n'),
        '',
      );
    });

    await refreshShellEnvironment();

    expect(process.env.AWS_BEARER_TOKEN_BEDROCK).toBe('bedrock-token');
    expect(process.env.AWS_REGION).toBe('us-east-1');
    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(process.env.UNRELATED_SECRET).toBeUndefined();
    expect(execFileMock).toHaveBeenCalledWith(
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']),
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
    const powerShellScript = execFileMock.mock.calls[0][1].at(-1);
    expect(powerShellScript).toContain('$PROFILE.CurrentUserAllHosts');
    expect(powerShellScript).toContain("GetEnvironmentVariables('User')");
  });

  it('keeps the inherited environment when Windows has no PowerShell', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    detectWindowsShellMock.mockResolvedValue({
      displayName: 'cmd.exe',
      path: 'cmd.exe',
      type: 'cmd',
    });

    await refreshShellEnvironment();

    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('preserves PATH when the login shell returns no delimited value', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null, 'shell startup output only', '');
    });

    await refreshShellEnvironment();

    expect(process.env.PATH).toBe('/usr/bin:/bin');
  });

  it('rejects without replacing PATH when shell startup fails', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(new Error('shell failed'), '', '');
    });

    await expect(refreshShellEnvironment()).rejects.toThrow('shell failed');
    expect(process.env.PATH).toBe('/usr/bin:/bin');
  });
});
