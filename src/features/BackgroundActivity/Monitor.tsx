import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { createModal, toast } from '@lobehub/ui/base-ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useSingleton } from '@/hooks/useSingleton';
import { useGlobalStore } from '@/store/global';

import ActivityTable, { topicName } from './ActivityTable';
import {
  formatCpu,
  formatMemory,
  ResourceAlerts,
  selectActivity,
  stopActivity,
  useActivities,
} from './state';

export default function BackgroundActivityMonitor() {
  const state = useActivities();
  const { t } = useTranslation('chat');
  const router = useQueryRoute();
  const alerts = useSingleton(() => new ResourceAlerts());
  const sampled = useRef(0);
  useEffect(() => {
    if (state.error || sampled.current === state.sampledAt) return;
    sampled.current = state.sampledAt;
    for (const activity of alerts.update(state.activities)) {
      const topic = topicName(activity.topicId);
      toast.warning({
        title: t('backgroundActivity.highUsage'),
        id: `background-${activity.rootId}`,
        description: t('backgroundActivity.alertDesc', {
          name: topic ? `${activity.label} · ${topic}` : activity.label,
          memory: formatMemory(activity.memoryMB),
          cpu: formatCpu(activity.cpuPercent),
        }),
        actions: [
          {
            label: t('backgroundActivity.details'),
            variant: 'text',
            onClick: () => {
              selectActivity(activity.rootId);
              if (activity.agentId && activity.topicId) {
                router.push(AGENT_CHAT_TOPIC_URL(activity.agentId, activity.topicId));
                useGlobalStore.getState().toggleRightPanel(false);
                useGlobalStore.getState().toggleWorkingOverview(true);
              } else {
                createModal({
                  title: t('backgroundActivity.title'),
                  content: (
                    <div style={{ display: 'flex', maxHeight: '60vh', marginInline: -12 }}>
                      <ActivityTable />
                    </div>
                  ),
                  footer: null,
                  width: 640,
                });
              }
            },
          },
          {
            label: t('backgroundActivity.stop'),
            variant: 'danger',
            onClick: () => {
              stopActivity(activity.rootId).catch((error) => {
                console.error(error);
                toast.error(t('backgroundActivity.stopFailed'));
              });
            },
          },
        ],
      });
    }
  }, [state, t, router, alerts]);
  return null;
}
