import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import { processRegistry } from '@/utils/processRegistry';

import ProcessManagerCtr from '../ProcessManagerCtr';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

function mkChild(pid: number): ChildProcess {
  const e = new EventEmitter() as ChildProcess;
  (e as any).pid = pid;
  (e as any).kill = vi.fn();
  return e;
}

describe('ProcessManagerCtr', () => {
  let controller: ProcessManagerCtr;
  const broadcastToAllWindows = vi.fn();
  const mockApp = { browserManager: { broadcastToAllWindows } } as unknown as App;

  beforeEach(() => {
    vi.clearAllMocks();
    // Empty the shared registry between tests so state doesn't leak.
    for (const p of processRegistry.list()) processRegistry.forget(p.shellId);
    controller = new ProcessManagerCtr(mockApp);
  });

  afterEach(() => {
    for (const p of processRegistry.list()) processRegistry.forget(p.shellId);
  });

  it('listProcesses returns current registry entries as ProcessInfo', async () => {
    processRegistry.register({
      command: 'ls',
      process: mkChild(100),
      tags: { ownerModule: 'shell', topicId: 't1' },
    });

    const res = await controller.listProcesses({});
    expect(res.processes).toHaveLength(1);
    expect(res.processes[0].topicId).toBe('t1');
    expect(res.processes[0].ownerModule).toBe('shell');
  });

  it('listProcesses filters by topicId', async () => {
    processRegistry.register({
      command: 'a',
      process: mkChild(1),
      tags: { ownerModule: 'shell', topicId: 't1' },
    });
    processRegistry.register({
      command: 'b',
      process: mkChild(2),
      tags: { ownerModule: 'shell', topicId: 't2' },
    });
    const res = await controller.listProcesses({ topicId: 't1' });
    expect(res.processes).toHaveLength(1);
    expect(res.processes[0].topicId).toBe('t1');
  });

  it('killProcess refuses ownerModule-only and returns success: false', async () => {
    const res = await controller.killProcess({ ownerModule: 'shell' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/ownerModule alone/);
    expect(res.killedShellIds).toEqual([]);
  });

  it('killProcess kills by shellId and returns shellIds', async () => {
    const entry = processRegistry.register({
      command: 'sleep',
      process: mkChild(123),
      tags: { ownerModule: 'shell' },
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const res = await controller.killProcess({ shellId: entry.shellId });
    expect(res.success).toBe(true);
    expect(res.killedShellIds).toEqual([entry.shellId]);
    killSpy.mockRestore();
  });
});
