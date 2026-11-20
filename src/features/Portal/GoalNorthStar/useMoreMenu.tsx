import { confirmModal, Icon, toast } from '@lobehub/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { openDeclareMetricModal } from '@/features/AgentGoals/NorthStarMetrics/DeclareMetricModal';
import { openRecordObservationModal } from '@/features/AgentGoals/NorthStarMetrics/RecordObservationModal';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

export const useGoalNorthStarMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation(['chat', 'common']);
  const view = useChatStore(chatPortalSelectors.goalNorthStarView);
  const { allowed: canEdit } = usePermission('create_content');
  const [refreshGoalGraph, refreshGoalMetricSeries, removeGoalMetric] = useGoalStore((s) => [
    s.refreshGoalGraph,
    s.refreshGoalMetricSeries,
    s.removeGoalMetric,
  ]);
  const criterion = useGoalStore((s) =>
    view
      ? goalSelectors
          .goalGraph(view.goalId)(s)
          ?.goal.config?.acceptance?.metrics?.find((item) => item.key === view.metricKey)
      : undefined,
  );

  if (!view) return;
  const { goalId } = view;

  // A clause nobody can measure would hold acceptance forever; removing it is
  // the way out. The panel stays open on the series and says it was removed.
  const removeMetric = (key: string, name: string) =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('goalProcess.northStar.remove.confirm', { name, ns: 'chat' }),
      okButtonProps: { danger: true },
      okText: t('goalProcess.northStar.remove.title', { ns: 'chat' }),
      onOk: async () => {
        try {
          await removeGoalMetric(goalId, key);
        } catch (error) {
          console.error('[NorthStar] failed to remove metric:', error);
          toast.error(t('goalProcess.northStar.remove.failed', { ns: 'chat' }));
        }
      },
      title: t('goalProcess.northStar.remove.title', { ns: 'chat' }),
    });

  return {
    // The clause's actions sit beside its title, out of the reading flow of
    // the number, the trend and the history.
    extraItems:
      canEdit && criterion
        ? [
            {
              icon: <Icon icon={Plus} />,
              key: 'record',
              label: t('goalProcess.northStar.record.title'),
              onClick: () =>
                openRecordObservationModal(goalId, criterion.key, criterion.title || criterion.key),
            },
            {
              icon: <Icon icon={Pencil} />,
              key: 'edit',
              label: t('goalProcess.northStar.edit.title'),
              onClick: () => openDeclareMetricModal(goalId, criterion),
            },
            // Named for what it does, not the generic "Delete": only the clause
            // goes, its observation history stays.
            {
              danger: true,
              icon: <Icon icon={Trash2} />,
              key: 'remove',
              label: t('goalProcess.northStar.remove.title'),
              onClick: () => removeMetric(criterion.key, criterion.title || criterion.key),
            },
          ]
        : undefined,
    // A clause lives in its goal's config and its numbers in the goal's metric
    // series, so refreshing re-reads both.
    refresh: () => Promise.all([refreshGoalGraph(goalId), refreshGoalMetricSeries(goalId)]),
  };
};
