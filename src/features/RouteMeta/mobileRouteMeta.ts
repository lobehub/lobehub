import { agentDisplayName } from '@lobechat/types';
import { t } from 'i18next';
import { Settings } from 'lucide-react';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { useAgentMeta } from '@/store/agent/projection';

const MobileAgentSettingsDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const meta = useAgentMeta(params.aid ?? '');

  usePublishDynamicRouteMeta(
    {
      title: agentDisplayName(meta)
        ? t('header.sessionWithName', { name: agentDisplayName(meta), ns: 'setting' })
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
