import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { SettingsTabs } from '@/store/global/initialState';

import { useCategory } from '../hooks/useCategory';

const SettingsDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const { t: tAuth } = useTranslation('auth');
  const groups = useCategory();
  const activeTab = (params.tab as SettingsTabs) || SettingsTabs.Profile;

  const label =
    activeTab === SettingsTabs.Profile
      ? tAuth('tab.profile')
      : groups.flatMap((group) => group.items).find((item) => item.key === activeTab)?.label;

  usePublishDynamicRouteMeta({ title: label || undefined }, onResolve);

  return null;
};

export const settingsRouteMeta = routeMeta({
  DynamicMeta: SettingsDynamicMeta,
  icon: Settings,
  titleKey: 'navigation.settings',
});
