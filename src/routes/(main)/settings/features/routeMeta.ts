import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type DynamicRouteMeta, routeMeta } from '@/spa/router/routeMeta';
import { SettingsTabs } from '@/store/global/initialState';

import { useCategory } from '../hooks/useCategory';

export const settingsRouteMeta = routeMeta({
  icon: Settings,
  titleKey: 'navigation.settings',
  useDynamicMeta: (params): DynamicRouteMeta => {
    const { t: tAuth } = useTranslation('auth');
    const groups = useCategory();
    const activeTab = (params.tab as SettingsTabs) || SettingsTabs.Profile;

    if (activeTab === SettingsTabs.Profile) return { title: tAuth('tab.profile') };

    const label = groups
      .flatMap((group) => group.items)
      .find((item) => item.key === activeTab)?.label;

    return { title: label || undefined };
  },
});
