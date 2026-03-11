import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { Trash } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { agentCronJobService } from '@/services/agentCronJob';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';

export const useCronJobDropdownMenu = (
  cronJobId: string,
  topics: Array<{ id: string }>,
): MenuProps['items'] => {
  const { t } = useTranslation(['setting', 'common']);
  const { modal } = App.useApp();

  const refreshCronTopics = useAgentStore((s) => s.internal_refreshCronTopics);

  const handleDeleteCronJob = useCallback(async () => {
    try {
      // Delete all topics associated with this cron job
      if (topics.length > 0) {
        const topicIds = topics.map((t) => t.id);
        await topicService.batchRemoveTopics(topicIds);
      }

      // Delete the cron job
      await agentCronJobService.delete(cronJobId);

      // Refresh the cron topics list
      await refreshCronTopics();
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      modal.error({
        content: t('agentCronJobs.deleteFailed' as any),
        title: t('error' as any, { ns: 'common' }),
      });
    }
  }, [cronJobId, topics, refreshCronTopics, modal, t]);

  const handleClearTopics = useCallback(async () => {
    if (topics.length === 0) return;

    try {
      const topicIds = topics.map((t) => t.id);
      await topicService.batchRemoveTopics(topicIds);

      // Refresh the cron topics list
      await refreshCronTopics();
    } catch (error) {
      console.error('Failed to clear topics:', error);
      modal.error({
        content: t('agentCronJobs.clearTopicsFailed' as any),
        title: t('error' as any, { ns: 'common' }),
      });
    }
  }, [topics, refreshCronTopics, modal, t]);

  return useMemo(
    () =>
      [
        {
          icon: <Icon icon={Trash} />,
          key: 'clearTopics',
          label: t('agentCronJobs.clearTopics' as any),
          onClick: () => {
            modal.confirm({
              cancelText: t('cancel', { ns: 'common' }),
              centered: true,
              content: t('agentCronJobs.confirmClearTopics' as any, { count: topics.length }),
              okButtonProps: { danger: true },
              okText: t('ok', { ns: 'common' }),
              onOk: handleClearTopics,
              title: t('agentCronJobs.clearTopics' as any),
            });
          },
        },
        {
          type: 'divider' as const,
        },
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'deleteCronJob',
          label: t('agentCronJobs.deleteCronJob' as any),
          onClick: () => {
            modal.confirm({
              cancelText: t('cancel', { ns: 'common' }),
              centered: true,
              content: t('agentCronJobs.confirmDeleteCronJob' as any),
              okButtonProps: { danger: true },
              okText: t('ok', { ns: 'common' }),
              onOk: handleDeleteCronJob,
              title: t('agentCronJobs.deleteCronJob' as any),
            });
          },
        },
      ].filter(Boolean) as MenuProps['items'],
    [topics.length, handleClearTopics, handleDeleteCronJob, t, modal],
  );
};
