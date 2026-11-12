import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';

/**
 * Refresh every loaded task list after a committed batch (or undo), without
 * making anyone wait for it. A failed refresh only means the list on screen
 * may be stale, so it says that, with a retry.
 */
export const useBackgroundTaskListRefresh = () => {
  const { t } = useTranslation('chat');
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);

  return useCallback(() => {
    void refreshTaskList().catch((error: unknown) => {
      console.error('[task batch] list refresh failed after a committed batch', error);
      const retry = () => {
        void refreshTaskList().catch((retryError: unknown) => {
          console.error('[task batch] list refresh retry failed', retryError);
        });
      };
      toast.warning({
        actions: [{ label: t('taskList.bulk.refreshFailed.retry'), onClick: retry }],
        description: t('taskList.bulk.refreshFailed.desc'),
        title: t('taskList.bulk.refreshFailed.title'),
      });
    });
  }, [refreshTaskList, t]);
};
