import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CodexClientModule from '../codex/CodexAppServerClient';
import { CodexAppServerRpcError } from '../codex/CodexAppServerClient';
import { listCodexModels } from './codex';

const { close, construct, request } = vi.hoisted(() => ({
  close: vi.fn(),
  construct: vi.fn(),
  request: vi.fn(),
}));

vi.mock('../codex/CodexAppServerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof CodexClientModule>();
  return {
    ...actual,
    CodexAppServerClient: class {
      close = close;
      request = request;
      constructor(options: unknown) {
        construct(options);
      }
    },
  };
});

const options = {
  commandPath: '/custom/codex',
  cwd: '/repo',
  env: { CODEX_HOME: '/custom/config' },
  timeoutMs: 100,
};

describe('Codex model discovery', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.useRealTimers());

  it('reads all pages without creating a task and returns CLI model values, labels and ordering', async () => {
    request
      .mockResolvedValueOnce({
        data: [
          { displayName: 'Future model', id: 'catalog-entry', model: 'future-model' },
          { hidden: true, model: 'hidden-model' },
        ],
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({
        data: [{ model: 'future-model' }, { model: 'provider/another-model' }],
        nextCursor: null,
      });

    await expect(listCodexModels(options)).resolves.toEqual([
      { id: 'future-model', label: 'Future model', modelId: 'future-model', providerId: 'codex' },
      { id: 'provider/another-model', modelId: 'provider/another-model', providerId: 'codex' },
    ]);
    expect(request.mock.calls).toEqual([
      ['model/list', { includeHidden: false, limit: 100 }],
      ['model/list', { cursor: 'next', includeHidden: false, limit: 100 }],
    ]);
    expect(construct).toHaveBeenCalledWith(
      expect.objectContaining({
        commandPath: options.commandPath,
        cwd: options.cwd,
        env: options.env,
        reconnectMaxAttempts: 0,
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves configuration but does not forward exec-only switches', async () => {
    request.mockResolvedValue({ data: [], nextCursor: null });
    await listCodexModels({
      ...options,
      args: [
        '--full-auto',
        '--json',
        '-m',
        'future-model',
        '-c',
        'model_provider="custom"',
        '--config=model_catalog_json="catalog.json"',
        '--cd',
        'subdir',
        '--enable',
        'feature_name',
      ],
    });
    expect(construct).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          '-c',
          'model_provider="custom"',
          '--config',
          'model_catalog_json="catalog.json"',
          '--enable',
          'feature_name',
        ],
        cwd: '/repo/subdir',
      }),
    );
  });

  it('preserves compact config and working-directory flags', async () => {
    request.mockResolvedValue({ data: [], nextCursor: null });
    await listCodexModels({ ...options, args: ['-cmodel_provider="custom"', '-Csubdir'] });
    expect(construct).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['-c', 'model_provider="custom"'],
        cwd: '/repo/subdir',
      }),
    );
  });

  it.each(['--oss', '--profile=team', '-p', '-pteam', '--ignore-user-config'])(
    'does not query the wrong provider for unsupported %s',
    async (flag) => {
      await expect(listCodexModels({ ...options, args: [flag] })).rejects.toMatchObject({
        code: 'unsupported_configuration',
      });
      expect(construct).not.toHaveBeenCalled();
    },
  );

  it('reports unsupported model/list and closes the connection', async () => {
    request.mockRejectedValue(new CodexAppServerRpcError('Unknown method', -32_601));
    await expect(listCodexModels(options)).rejects.toMatchObject({ code: 'unsupported_client' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes on process failure', async () => {
    request.mockRejectedValue(new Error('Process exited'));
    await expect(listCodexModels(options)).rejects.toThrow('Process exited');
    expect(close).toHaveBeenCalledOnce();
  });

  it('bounds the entire query even when a later page hangs', async () => {
    vi.useFakeTimers();
    request
      .mockResolvedValueOnce({ data: [], nextCursor: 'next' })
      .mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(listCodexModels(options)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    await vi.advanceTimersByTimeAsync(options.timeoutMs);
    await result;
    expect(request).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([{}, { data: [{ id: 'id-without-model' }] }, { data: [], nextCursor: 123 }])(
    'rejects a malformed catalog instead of reporting a successful empty list: %j',
    async (page) => {
      request.mockResolvedValue(page);
      await expect(listCodexModels(options)).rejects.toThrow('Invalid Codex model catalog');
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it('rejects repeated cursors instead of looping forever', async () => {
    request.mockResolvedValue({ data: [], nextCursor: 'repeat' });
    await expect(listCodexModels(options)).rejects.toThrow('cursor');
    expect(request).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
});
