import { PassThrough } from 'node:stream';

import { ClaudeCodeLiveInput } from '@lobechat/heterogeneous-agents/spawn';
import { describe, expect, it, vi } from 'vitest';

import HeterogeneousAgentCtr from './HeterogeneousAgentImpl';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getAppPath: vi.fn(() => '/fake/appPath'),
    getPath: vi.fn((name: string) => `/fake/${name}`),
    getVersion: vi.fn(() => '1.0.0-test'),
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

const createCtr = (sessions: Record<string, unknown>) => {
  const ctr = new HeterogeneousAgentCtr({
    appStoragePath: '/fake/storage',
    storeManager: { get: vi.fn() },
  } as any);
  const map = (ctr as any).sessions as Map<string, unknown>;
  for (const [id, session] of Object.entries(sessions)) map.set(id, session);
  return ctr;
};

describe('HeterogeneousAgentCtr.stopBackgroundTask', () => {
  it('asks the SDK session to stop the task', async () => {
    const stopTask = vi.fn().mockResolvedValue(undefined);
    const ctr = createCtr({ s1: { sdkSession: { stopTask } } });

    await ctr.stopBackgroundTask({ sessionId: 's1', taskId: 'bys1w0wxo' });

    expect(stopTask).toHaveBeenCalledWith('bys1w0wxo');
  });

  it('writes stop_task into the open input of a CLI run', async () => {
    const stdin = new PassThrough();
    const written: any[] = [];
    stdin.on('data', (chunk: Buffer) => {
      for (const raw of chunk.toString().split('\n')) if (raw) written.push(JSON.parse(raw));
    });
    const liveInput = new ClaudeCodeLiveInput(stdin);
    const ctr = createCtr({ cli: { liveInput, process: {} } });

    const stopping = ctr.stopBackgroundTask({ sessionId: 'cli', taskId: 'bys1w0wxo' });
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toMatchObject({
      request: { subtype: 'stop_task', task_id: 'bys1w0wxo' },
      type: 'control_request',
    });
    liveInput.observe(
      `${JSON.stringify({
        response: { request_id: written[0].request_id, response: {}, subtype: 'success' },
        type: 'control_response',
      })}\n`,
    );
    await expect(stopping).resolves.toBeUndefined();
  });

  it('refuses a run whose input has closed', async () => {
    const ctr = createCtr({ cli: { process: {} } });

    await expect(ctr.stopBackgroundTask({ sessionId: 'cli', taskId: 't' })).rejects.toThrow(
      'cannot stop a single background task',
    );
    await expect(ctr.stopBackgroundTask({ sessionId: 'gone', taskId: 't' })).rejects.toThrow();
  });
});
