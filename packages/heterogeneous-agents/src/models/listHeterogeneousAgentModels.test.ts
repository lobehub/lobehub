import * as childProcess from 'node:child_process';
import type * as os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'darwin') };
});

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(childProcess.execFile);

const resolveExecFile = (stdout: string, stderr = '') => {
  execFileMock.mockImplementationOnce(((file: string, args: any, options: any, callback: any) => {
    callback(null, { stderr, stdout });
    return {} as any;
  }) as any);
};

const rejectExecFile = (error: Error) => {
  execFileMock.mockImplementationOnce(((file: string, args: any, options: any, callback: any) => {
    callback(error, { stderr: '', stdout: '' });
    return {} as any;
  }) as any);
};

const importModule = () => import('./listHeterogeneousAgentModels');

describe('OpenCode model discovery', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('parses opaque model ids, splitting only at the first slash and preserving order', async () => {
    const { parseOpenCodeModelCatalog } = await importModule();

    expect(
      parseOpenCodeModelCatalog(
        [
          'openai/gpt-5.6',
          '',
          'openrouter/google/gemini-2.5-pro',
          'cloudflare/@cf/meta/llama-3.1-8b-instruct',
          'openai/gpt-5.6',
          'PATH=/usr/local/bin:/usr/bin',
          'diagnostic-without-model-id',
        ].join('\n'),
      ),
    ).toEqual([
      { id: 'openai/gpt-5.6', modelId: 'gpt-5.6', providerId: 'openai' },
      {
        id: 'openrouter/google/gemini-2.5-pro',
        modelId: 'google/gemini-2.5-pro',
        providerId: 'openrouter',
      },
      {
        id: 'cloudflare/@cf/meta/llama-3.1-8b-instruct',
        modelId: '@cf/meta/llama-3.1-8b-instruct',
        providerId: 'cloudflare',
      },
    ]);
  });

  it('runs the configured binary with plugins enabled and forwards cwd/env', async () => {
    resolveExecFile('openai/gpt-5.6\nopenrouter/google/gemini-2.5-pro\n');
    const { listHeterogeneousAgentModels } = await importModule();

    const result = await listHeterogeneousAgentModels({
      command: '/custom/opencode',
      cwd: '/repo',
      env: { OPENCODE_CONFIG_DIR: '/config', PATH: '/custom/bin' },
      type: 'opencode',
    });

    expect(result).toMatchObject({
      models: [
        { id: 'openai/gpt-5.6', modelId: 'gpt-5.6', providerId: 'openai' },
        {
          id: 'openrouter/google/gemini-2.5-pro',
          modelId: 'google/gemini-2.5-pro',
          providerId: 'openrouter',
        },
      ],
      status: 'success',
    });
    expect(execFileMock).toHaveBeenCalledWith(
      '/custom/opencode',
      ['models'],
      expect.objectContaining({
        cwd: '/repo',
        env: { OPENCODE_CONFIG_DIR: '/config', PATH: '/custom/bin' },
        maxBuffer: 256 * 1024,
        timeout: 15_000,
      }),
      expect.any(Function),
    );
  });

  it('keeps the resolver login-shell PATH when the caller also provides PATH', async () => {
    const originalShell = process.env.SHELL;
    process.env.SHELL = '/bin/zsh';
    rejectExecFile(new Error('not on inherited PATH'));
    resolveExecFile('/login/bin:/usr/bin');
    resolveExecFile('/login/bin/opencode\n');
    resolveExecFile('1.18.3');
    resolveExecFile('openai/gpt-5.6\n');

    try {
      const { listHeterogeneousAgentModels } = await importModule();
      const result = await listHeterogeneousAgentModels({
        env: { PATH: '/inherited/bin' },
        type: 'opencode',
      });

      expect(result.status).toBe('success');
      const [command, args, options] = execFileMock.mock.calls.at(-1) as unknown as [
        string,
        string[],
        { env: NodeJS.ProcessEnv },
      ];
      expect(command).toBe('/login/bin/opencode');
      expect(args).toEqual(['models']);
      expect(options.env.PATH?.split(path.delimiter)).toEqual(
        expect.arrayContaining(['/inherited/bin', '/login/bin', '/usr/bin']),
      );
    } finally {
      if (originalShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = originalShell;
    }
  });

  it('returns a stable missing-CLI error', async () => {
    rejectExecFile(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    const { listHeterogeneousAgentModels } = await importModule();

    await expect(
      listHeterogeneousAgentModels({ command: '/missing/opencode', type: 'opencode' }),
    ).resolves.toMatchObject({
      error: { code: 'cli_not_found' },
      status: 'error',
    });
  });

  it('returns a stable timeout error', async () => {
    rejectExecFile(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }));
    const { listHeterogeneousAgentModels } = await importModule();

    await expect(
      listHeterogeneousAgentModels({ command: '/slow/opencode', type: 'opencode' }),
    ).resolves.toMatchObject({
      error: { code: 'timeout' },
      status: 'error',
    });
  });
});
