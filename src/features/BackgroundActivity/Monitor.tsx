import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { createModal, toast } from '@lobehub/ui/base-ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useSingleton } from '@/hooks/useSingleton';
import { useGlobalStore } from '@/store/global';

import { BackgroundActivity, topicName } from './index';
import { ResourceAlerts, selectActivity, useActivities } from './state';

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
      toast.warning({
        title: t('backgroundActivity.highUsage'),
        id: `background-${activity.rootId}`,
        description: `${topicName(activity.topicId) || activity.label} · ${Math.round(activity.memoryMB)} MB · ${Math.round(activity.cpuPercent ?? 0)}% CPU`,
        actions: [
          {
            label: t('backgroundActivity.details'),
            onClick: () => {
              selectActivity(activity.rootId);
              if (activity.agentId && activity.topicId) {
                router.push(AGENT_CHAT_TOPIC_URL(activity.agentId, activity.topicId));
                useGlobalStore.getState().toggleRightPanel(false);
                useGlobalStore.getState().toggleWorkingOverview(true);
              } else {
                createModal({
                  title: t('backgroundActivity.title'),
                  content: <BackgroundActivity global />,
                  footer: null,
                  width: 640,
                });
              }
            },
          },
        ],
      });
    }
  }, [state, t, router, alerts]);
  return null;
}
