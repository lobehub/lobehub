import { describe, expect, it, vi } from 'vitest';

import {
  resolveWatchableShell,
  watchToolCallCompletion,
  withCompletionWatch,
} from './completionWatch';

const request = {
  completion: { toolCallId: 'call-1' },
  operationId: 'op-1',
  toolCall: { apiName: 'runCommand', arguments: '{}', identifier: 'lobe-local-system' },
};

const done = { content: 'Exit code: 0', state: { exitCode: 0, running: false }, success: true };

describe('resolveWatchableShell', () => {
  it('watches a command still running after its wait window', () => {
    expect(
      resolveWatchableShell(request, {
        state: { commandId: 'sh-1', running: true },
        success: true,
      }),
    ).toBe('sh-1');
  });

  it('watches a background spawn', () => {
    expect(
      resolveWatchableShell(request, {
        state: { commandId: 'sh-1', isBackground: true },
        success: true,
      }),
    ).toBe('sh-1');
  });

  it.each([
    ['the server did not ask', { ...request, completion: undefined }, { running: true }],
    ['the command already exited', request, { exitCode: 0, running: false }],
    [
      'it is not runCommand',
      { ...request, toolCall: { ...request.toolCall, apiName: 'readFile' } },
      { running: true },
    ],
    [
      'it is an MCP call',
      { ...request, toolCall: { ...request.toolCall, type: 'mcp' as const } },
      { running: true },
    ],
  ])('does not watch when %s', (_label, req, state) => {
    expect(
      resolveWatchableShell(req as any, { state: { commandId: 'sh-1', ...state }, success: true }),
    ).toBeUndefined();
  });

  it('marks the reply so the server may park', () => {
    expect(
      withCompletionWatch({ content: '', state: { commandId: 'sh-1' }, success: true }).state,
    ).toEqual({ commandId: 'sh-1', completionWatch: true });
  });
});

describe('watchToolCallCompletion', () => {
  const sleep = vi.fn(async () => {});
  const reporter = (statuses: string[]) => {
    const reportToolCallCompletion = vi.fn(async () => {
      const status = statuses.shift();
      if (!status) throw new Error('Gateway not connected');
      return { operationId: 'op-1', status, toolCallId: 'call-1' } as any;
    });
    return { off: vi.fn(), on: vi.fn(), reportToolCallCompletion };
  };

  it('observes until the command ends and reports its final result', async () => {
    const observe = vi
      .fn()
      .mockResolvedValueOnce({ done: false, result: { content: '', success: true } })
      .mockResolvedValueOnce({ done: true, result: done });
    const r = reporter(['delivered']);

    const status = await watchToolCallCompletion({
      getReporter: () => r,
      observe,
      operationId: 'op-1',
      sleep,
      toolCallId: 'call-1',
    });

    expect(status).toBe('delivered');
    expect(observe).toHaveBeenCalledTimes(2);
    expect(r.reportToolCallCompletion).toHaveBeenCalledWith({
      operationId: 'op-1',
      result: done,
      toolCallId: 'call-1',
    });
  });

  it('resends after a retry verdict or a dropped connection', async () => {
    const r = reporter(['retry']);
    r.reportToolCallCompletion
      .mockImplementationOnce(async () => ({ status: 'retry' }) as any)
      .mockImplementationOnce(async () => {
        throw new Error('Gateway not connected');
      })
      .mockImplementationOnce(async () => ({ status: 'delivered' }) as any);

    const status = await watchToolCallCompletion({
      getReporter: () => r,
      observe: async () => ({ done: true, result: done }),
      operationId: 'op-1',
      sleep,
      toolCallId: 'call-1',
    });

    expect(status).toBe('delivered');
    expect(r.reportToolCallCompletion).toHaveBeenCalledTimes(3);
  });

  it('stops on a rejection', async () => {
    const r = reporter(['rejected']);

    await expect(
      watchToolCallCompletion({
        getReporter: () => r,
        observe: async () => ({ done: true, result: done }),
        operationId: 'op-1',
        sleep,
        toolCallId: 'call-1',
      }),
    ).resolves.toBe('rejected');
    expect(r.reportToolCallCompletion).toHaveBeenCalledTimes(1);
  });

  it('reports an observation failure instead of going silent', async () => {
    const r = reporter(['delivered']);

    await watchToolCallCompletion({
      getReporter: () => r,
      observe: async () => {
        throw new Error('shell runtime gone');
      },
      operationId: 'op-1',
      sleep,
      toolCallId: 'call-1',
    });

    expect(r.reportToolCallCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ error: 'shell runtime gone', success: false }),
      }),
    );
  });

  it('gives up once the result is older than the server would wait', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(0).mockReturnValue(10_000);
    const r = reporter([]);

    const status = await watchToolCallCompletion({
      getReporter: () => r,
      maxAgeMs: 5000,
      observe: async () => ({ done: true, result: done }),
      operationId: 'op-1',
      sleep,
      toolCallId: 'call-1',
    });

    expect(status).toBe('expired');
    now.mockRestore();
  });
});
