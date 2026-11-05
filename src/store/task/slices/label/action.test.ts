import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClientDataSWR } from '@/libs/swr';
import { taskLabelService } from '@/services/taskLabel';

import { useTaskStore } from '../../store';

vi.mock('@/services/taskLabel', () => ({
  taskLabelService: {
    addToTask: vi.fn(),
    changeForTask: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
    removeFromTask: vi.fn(),
  },
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

const label = (id: string, name: string) =>
  ({ color: null, id, isGroup: false, name, parentId: null, usageCount: 0 }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({ taskLabels: [], taskLabelsInit: false, taskLabelsScope: null });
});

describe('TaskLabelSliceAction', () => {
  describe('workspace scope', () => {
    it('clears the registry when the scope changes', () => {
      useTaskStore.setState({
        taskLabels: [label('a', 'From A')],
        taskLabelsInit: true,
        taskLabelsScope: 'ws-a',
      });

      useTaskStore.getState().internal_resetTaskLabelsScope('ws-b');

      expect(useTaskStore.getState()).toMatchObject({
        taskLabels: [],
        taskLabelsInit: false,
        taskLabelsScope: 'ws-b',
      });
    });

    it('keeps the registry when the scope is unchanged', () => {
      useTaskStore.setState({
        taskLabels: [label('a', 'From A')],
        taskLabelsInit: true,
        taskLabelsScope: 'ws-a',
      });

      useTaskStore.getState().internal_resetTaskLabelsScope('ws-a');

      expect(useTaskStore.getState().taskLabels).toHaveLength(1);
    });

    it('ignores a response for a workspace the user already left', () => {
      useTaskStore.setState({ taskLabelsScope: 'ws-b' });
      useTaskStore.getState().useFetchTaskLabels(true, 'ws-a');
      const { onSuccess } = vi.mocked(useClientDataSWR).mock.calls[0][2] as any;

      onSuccess([label('a', 'From A')]);
      expect(useTaskStore.getState().taskLabelsInit).toBe(false);

      useTaskStore.getState().useFetchTaskLabels(true, 'ws-b');
      const { onSuccess: onSuccessB } = vi.mocked(useClientDataSWR).mock.calls[1][2] as any;
      onSuccessB([label('b', 'From B')]);
      expect(useTaskStore.getState()).toMatchObject({
        taskLabels: [expect.objectContaining({ name: 'From B' })],
        taskLabelsInit: true,
      });
    });
  });

  describe('createTaskLabel', () => {
    it('does not add a label created in a workspace the user has since left', async () => {
      useTaskStore.setState({ taskLabels: [], taskLabelsInit: true, taskLabelsScope: 'ws-a' });
      vi.mocked(taskLabelService.create).mockImplementation(async () => {
        useTaskStore.getState().internal_resetTaskLabelsScope('ws-b');
        return label('a', 'From A');
      });

      await useTaskStore.getState().createTaskLabel({ name: 'From A' });

      expect(useTaskStore.getState().taskLabels).toEqual([]);
    });
  });

  describe('setTaskLabels', () => {
    it('sends the add + remove delta as one request', async () => {
      vi.mocked(taskLabelService.changeForTask).mockResolvedValue([]);
      const frontend = label('l1', 'Frontend');
      const backend = label('l2', 'Backend');

      const ok = await useTaskStore.getState().setTaskLabels('T-1', [frontend], [backend]);

      expect(ok).toBe(true);
      expect(taskLabelService.changeForTask).toHaveBeenCalledTimes(1);
      expect(taskLabelService.changeForTask).toHaveBeenCalledWith('T-1', {
        add: ['l2'],
        remove: ['l1'],
      });
      expect(taskLabelService.addToTask).not.toHaveBeenCalled();
      expect(taskLabelService.removeFromTask).not.toHaveBeenCalled();
    });

    const stubCollections = (refresh: () => Promise<void>) => {
      const overlay = { commit: vi.fn(), rollback: vi.fn() };
      useTaskStore.setState({
        internal_beginCollectionTaskOptimistic: vi.fn(() => overlay),
        refreshTaskList: vi.fn(refresh),
      } as any);
      vi.mocked(taskLabelService.changeForTask).mockResolvedValue([]);
      return overlay;
    };

    it('commits the list overlay only after the lists re-fetched', async () => {
      const order: string[] = [];
      const overlay = stubCollections(async () => {
        order.push('refresh');
      });
      overlay.commit.mockImplementation(() => order.push('commit'));

      await useTaskStore.getState().setTaskLabels('T-1', [], [label('l2', 'Backend')]);

      expect(order).toEqual(['refresh', 'commit']);
      expect(overlay.rollback).not.toHaveBeenCalled();
    });

    it('sends rapid edits to one task in click order', async () => {
      stubCollections(async () => {});
      const sent: string[] = [];
      let releaseFirst!: () => void;
      vi.mocked(taskLabelService.changeForTask)
        .mockImplementationOnce(async (_id, delta) => {
          await new Promise<void>((resolve) => (releaseFirst = resolve));
          sent.push(`add ${delta.add}`);
          return [];
        })
        .mockImplementationOnce(async (_id, delta) => {
          sent.push(`add ${delta.add}`);
          return [];
        });
      const a = label('a', 'A');
      const b = label('b', 'B');

      const first = useTaskStore.getState().setTaskLabels('T-1', [], [a]);
      const second = useTaskStore.getState().setTaskLabels('T-1', [a], [b]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(sent).toEqual([]);
      releaseFirst();
      await Promise.all([first, second]);

      expect(sent).toEqual(['add a', 'add b']);
    });

    it('drops the overlay instead of persisting it when the re-fetch fails', async () => {
      const overlay = stubCollections(async () => {
        throw new Error('offline');
      });

      const ok = await useTaskStore.getState().setTaskLabels('T-1', [], [label('l2', 'Backend')]);

      expect(ok).toBe(true);
      expect(overlay.commit).not.toHaveBeenCalled();
      expect(overlay.rollback).toHaveBeenCalled();
    });
  });
});
