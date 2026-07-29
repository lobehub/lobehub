import { t } from 'i18next';
import { Settings } from 'lucide-react';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

const MobileAgentSettingsDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const meta = useAgentStore(agentSelectors.getAgentMetaById(params.aid ?? ''));

  usePublishDynamicRouteMeta(
    {
      title: meta.title
        ? t('header.sessionWithName', { name: meta.title, ns: 'setting' })
        : t('header.session', { ns: 'setting' }),
    },
    onResolve,
  );

  return null;
};

export const mobileAgentSettingsRouteMeta = routeMeta({
  DynamicMeta: MobileAgentSettingsDynamicMeta,
  icon: Settings,
  titleKey: 'navigation.chat',
});
