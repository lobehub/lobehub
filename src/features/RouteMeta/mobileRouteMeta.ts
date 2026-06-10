import { t } from 'i18next';
import { Settings } from 'lucide-react';

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
