import fs from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import type * as TaskRegistryModule from './taskRegistry';
import type { TaskEntry } from './taskRegistry';

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('../utils/logger', () => ({
  log: { warn: vi.fn() },
}));

const entry: TaskEntry = {
  agentType: 'hermes',
  operationId: 'op-1',
  pid: 4242,
  startedAt: '2026-11-15T04:14:47.000Z',
  taskId: 'op-1',
  topicId: 'tpc-1',
};

const enospc = () =>
  Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });

describe('taskRegistry', () => {
  let stored: string | undefined;
  let registry: typeof TaskRegistryModule;

  const failWrites = () =>
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw enospc();
    });
  const allowWrites = () =>
    vi.mocked(fs.writeFileSync).mockImplementation((_path, content) => {
      stored = String(content);
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    stored = undefined;
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      if (stored === undefined) throw new Error('ENOENT');
      return stored;
    });
    allowWrites();
    // Unsaved state lives in the module, so every case starts from a fresh one.
    vi.resetModules();
    registry = await import('./taskRegistry');
  });

  it('round-trips saved entries', () => {
    registry.saveTask(entry);
    expect(registry.getTask('op-1')).toEqual(entry);

    registry.removeTask('op-1');
    expect(registry.getTask('op-1')).toBeUndefined();
  });

  it('keeps a run it could not persist so its exit handler still owns it', () => {
    failWrites();

    expect(() => registry.saveTask(entry)).not.toThrow();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ENOSPC'));
    expect(registry.getTask('op-1')).toEqual(entry);
    expect(registry.listTasks()).toEqual([entry]);
  });

  it('forgets a removed run even when the removal cannot be persisted', () => {
    registry.saveTask(entry);
    failWrites();

    expect(() => registry.removeTask('op-1')).not.toThrow();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ENOSPC'));
    expect(registry.getTask('op-1')).toBeUndefined();
  });

  it('persists the unsaved state once the disk accepts writes again', () => {
    failWrites();
    registry.saveTask(entry);
    allowWrites();

    registry.saveTask({ ...entry, operationId: 'op-2', taskId: 'op-2' });

    expect(Object.keys(JSON.parse(stored!))).toEqual(['op-1', 'op-2']);
  });

  it('does not throw when the config directory cannot be created', () => {
    vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
      throw enospc();
    });

    expect(() => registry.saveTask(entry)).not.toThrow();
    expect(registry.getTask('op-1')).toEqual(entry);
  });
});
