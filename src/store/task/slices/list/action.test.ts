import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskStore } from '../../store';

// Mock task service
vi.mock('@/services/task', () => ({
  taskService: {
    list: vi.fn(),
  },
}));

// Mock SWR
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({
    isTaskListInit: false,
    listAgentId: undefined,
    tasks: [],
    tasksTotal: 0,
    viewMode: 'list',
  });
});

describe('TaskListSliceAction', () => {
  describe('setListAgentId', () => {
    it('should update listAgentId', () => {
      useTaskStore.getState().setListAgentId('agt_1');
      expect(useTaskStore.getState().listAgentId).toBe('agt_1');
    });

    it('should clear listAgentId with undefined', () => {
      useTaskStore.getState().setListAgentId('agt_1');
      useTaskStore.getState().setListAgentId(undefined);
      expect(useTaskStore.getState().listAgentId).toBeUndefined();
    });
  });

  describe('setViewMode', () => {
    it('should toggle to kanban', () => {
      useTaskStore.getState().setViewMode('kanban');
      expect(useTaskStore.getState().viewMode).toBe('kanban');
    });

    it('should toggle back to list', () => {
      useTaskStore.getState().setViewMode('kanban');
      useTaskStore.getState().setViewMode('list');
      expect(useTaskStore.getState().viewMode).toBe('list');
    });
  });

  describe('refreshTaskList', () => {
    it('should call mutate with correct key including visibility filter', async () => {
      const { mutate } = await import('@/libs/swr');
      useTaskStore.setState({ listAgentId: 'agt_1', listVisibility: 'private' });

      await useTaskStore.getState().refreshTaskList();

      expect(mutate).toHaveBeenCalledWith(['task:list', 'agt_1', 'private']);
    });
  });

  describe('setListVisibility', () => {
    it('should update visibility filter and reset list state', async () => {
      useTaskStore.setState({
        isTaskListInit: true,
        listVisibility: 'private',
        tasks: [{ id: 't1' }] as any,
        tasksTotal: 1,
      });

      useTaskStore.getState().setListVisibility('workspace');

      const state = useTaskStore.getState();
      expect(state.listVisibility).toBe('workspace');
      // Reset clears the previous-filter results so the chip flip doesn't
      // briefly render stale entries from the old filter.
      expect(state.tasks).toEqual([]);
      expect(state.tasksTotal).toBe(0);
      expect(state.isTaskListInit).toBe(false);
    });

    it('should no-op when the filter does not change', async () => {
      useTaskStore.setState({
        isTaskListInit: true,
        listVisibility: 'private',
        tasks: [{ id: 't1' }] as any,
        tasksTotal: 1,
      });

      useTaskStore.getState().setListVisibility('private');

      const state = useTaskStore.getState();
      expect(state.tasks).toHaveLength(1);
      expect(state.isTaskListInit).toBe(true);
    });
  });
});
