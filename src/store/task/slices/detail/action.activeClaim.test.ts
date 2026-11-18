import { afterEach, describe, expect, it } from 'vitest';

import { useTaskStore } from '../../store';

describe('TaskDetailSlice', () => {
  afterEach(() => {
    useTaskStore.setState({ activeTaskId: undefined, activeTaskRef: undefined });
  });

  describe('claimActiveTask', () => {
    it('hands the active task back to the page when a task opened beside it closes', () => {
      // The `/task/T-2` page is open; a task link in its run drawer opens T-1
      // in the Portal, and back / close unmounts that Portal.
      const releasePage = useTaskStore.getState().claimActiveTask('T-2');
      const releasePortal = useTaskStore.getState().claimActiveTask('T-1');
      expect(useTaskStore.getState().activeTaskRef).toBe('T-1');

      releasePortal();
      expect(useTaskStore.getState().activeTaskRef).toBe('T-2');

      releasePage();
      expect(useTaskStore.getState().activeTaskRef).toBeUndefined();
    });

    it('leaves the newest claim active when an older one is released first', () => {
      const releasePage = useTaskStore.getState().claimActiveTask('T-2');
      const releasePortal = useTaskStore.getState().claimActiveTask('T-1');

      releasePage();
      expect(useTaskStore.getState().activeTaskRef).toBe('T-1');

      releasePortal();
      expect(useTaskStore.getState().activeTaskRef).toBeUndefined();
    });

    it('keeps the task active while a second surface on the same task closes', () => {
      const releasePage = useTaskStore.getState().claimActiveTask('T-2');
      const releasePortal = useTaskStore.getState().claimActiveTask('T-2');

      releasePortal();
      expect(useTaskStore.getState().activeTaskRef).toBe('T-2');

      releasePage();
      expect(useTaskStore.getState().activeTaskRef).toBeUndefined();
    });

    it('ignores a release called twice', () => {
      const releasePage = useTaskStore.getState().claimActiveTask('T-2');
      const releasePortal = useTaskStore.getState().claimActiveTask('T-1');

      releasePortal();
      releasePortal();
      expect(useTaskStore.getState().activeTaskRef).toBe('T-2');

      releasePage();
    });
  });
});
