import { beforeEach, describe, expect, it, vi } from 'vitest';

import { taskService } from '@/services/task';
import { taskLabelService } from '@/services/taskLabel';

import { applyTaskLabelDelta } from './labelIds';

vi.mock('@/services/task', () => ({ taskService: { getDetail: vi.fn() } }));
vi.mock('@/services/taskLabel', () => ({
  taskLabelService: { changeForTask: vi.fn(), list: vi.fn() },
}));

const ref = (id: string) => ({ color: null, id, name: id, parentId: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(taskLabelService.changeForTask).mockResolvedValue([]);
});

describe('applyTaskLabelDelta', () => {
  it('applies the delta and undoes only it, keeping concurrent changes', async () => {
    vi.mocked(taskService.getDetail)
      .mockResolvedValueOnce({ data: { labels: [ref('bug'), ref('fe')] } } as any)
      .mockResolvedValueOnce({ data: { labels: [ref('feat'), ref('other')] } } as any);
    vi.mocked(taskLabelService.changeForTask).mockResolvedValueOnce([
      ref('feat'),
      ref('other'),
    ] as any);

    const undo = await applyTaskLabelDelta('T-1', { add: ['feat'], remove: ['fe'] }, true);
    await undo();

    expect(taskLabelService.changeForTask).toHaveBeenNthCalledWith(1, 'T-1', {
      add: ['feat'],
      remove: ['fe'],
    });
    expect(taskLabelService.changeForTask).toHaveBeenNthCalledWith(2, 'T-1', {
      add: ['bug', 'fe'],
      remove: ['feat'],
    });
  });

  it('skips the snapshot and the undo when nothing else follows', async () => {
    vi.mocked(taskLabelService.changeForTask).mockResolvedValueOnce([ref('feat')] as any);

    const undo = await applyTaskLabelDelta('T-1', { add: ['feat'], remove: [] }, false);
    await undo();

    expect(taskService.getDetail).not.toHaveBeenCalled();
    expect(taskLabelService.changeForTask).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for an empty delta', async () => {
    await applyTaskLabelDelta('T-1', { add: [], remove: [] }, true);
    expect(taskLabelService.changeForTask).not.toHaveBeenCalled();
  });
});
