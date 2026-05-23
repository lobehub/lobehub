import { t } from 'i18next';
import { MessageSquare, Settings } from 'lucide-react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';
import { routeMeta } from '@/spa/router/routeMeta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

export const mobileAgentSettingsRouteMeta = routeMeta({
  icon: Settings,
  titleKey: 'navigation.chat',
  useDynamicMeta: (params) => {
    const meta = useAgentStore(agentSelectors.getAgentMetaById(params.aid ?? ''));

    return {
      title: meta.title
        ? t('header.sessionWithName', { name: meta.title, ns: 'setting' })
        : t('header.session', { ns: 'setting' }),
    };
  },
});

export const shareTopicRouteMeta = routeMeta({
  icon: MessageSquare,
  titleKey: 'navigation.chat',
  useDynamicMeta: (params) => {
    const shareId = params.id;
    const { data } = useSWR(
      shareId ? ['shared-topic', shareId] : null,
      () => lambdaClient.share.getSharedTopic.query({ shareId: shareId! }),
      { revalidateOnFocus: false },
    );

    return {
      title: data?.title || undefined,
    };
  },
});
