import { execFile } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshShellEnvironment } from './shellPath';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const execFileMock = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

describe('refreshShellEnvironment', () => {
  const originalPath = process.env.PATH;
  const originalShell = process.env.SHELL;
  const originalAwsBearerTokenBedrock = process.env.AWS_BEARER_TOKEN_BEDROCK;
  const originalAwsProfile = process.env.AWS_PROFILE;
  const originalClaudeCodeUseBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
  const originalUnrelatedSecret = process.env.UNRELATED_SECRET;

  beforeEach(() => {
    process.env.PATH = '/usr/bin:/bin';
    process.env.SHELL = '/bin/zsh';
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    delete process.env.AWS_PROFILE;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.UNRELATED_SECRET;
    execFileMock.mockReset();
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
    if (originalAwsBearerTokenBedrock === undefined) delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    else process.env.AWS_BEARER_TOKEN_BEDROCK = originalAwsBearerTokenBedrock;
    if (originalAwsProfile === undefined) delete process.env.AWS_PROFILE;
    else process.env.AWS_PROFILE = originalAwsProfile;
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
  });

  it('imports Claude Code Bedrock settings from the login shell', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(
        null,
        [
          'shell startup output',
          '__LOBE_SHELL_PATH__/opt/homebrew/bin:/usr/bin__LOBE_SHELL_PATH__',
          '__LOBE_SHELL_ENV__AWS_BEARER_TOKEN_BEDROCK=bedrock-token\0AWS_PROFILE=bedrock-dev\0CLAUDE_CODE_USE_BEDROCK=1\0UNRELATED_SECRET=do-not-import\0__LOBE_SHELL_ENV__',
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
