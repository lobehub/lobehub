import type { CheckpointConfig } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';

import { normalizeCheckpointTaskRefs } from './utils';

afterEach(() => vi.restoreAllMocks());
describe('normalizeCheckpointTaskRefs', () => {
  it('preserves a consistent round-trip without a task lookup, including original order', async () => {
    const model = new TaskModel({} as LobeChatDatabase, 'user');
    const resolve = vi.spyOn(model, 'resolveRefs');
    const checkpoint: CheckpointConfig = {
      tasks: {
        beforeIds: ['OLD-1', 'OLD-2', 'OLD-1'],
        beforeTasks: [
          { id: 'task_2', identifier: 'OLD-2' },
          { id: 'task_1', identifier: 'OLD-1' },
        ],
      },
    };
    const result = await normalizeCheckpointTaskRefs(model, checkpoint);
    expect(result).toEqual(checkpoint);
    expect(result.tasks?.beforeTasks).toBe(checkpoint.tasks?.beforeTasks);
    expect(result.tasks?.beforeIds).toBe(checkpoint.tasks?.beforeIds);
    expect(resolve).not.toHaveBeenCalled();
  });
  it('clears stale pairs alongside an explicitly emptied list', async () => {
    const model = new TaskModel({} as LobeChatDatabase, 'user');
    vi.spyOn(model, 'resolveRefs').mockResolvedValue({
      ambiguous: [],
      missing: [],
      byRef: new Map(),
      tasks: [],
    });
    expect(
      await normalizeCheckpointTaskRefs(model, {
        tasks: { beforeIds: [], beforeTasks: [{ id: 'task_1', identifier: 'T-1' }] },
      }),
    ).toEqual({ tasks: { beforeIds: [], beforeTasks: [] } });
  });
});
