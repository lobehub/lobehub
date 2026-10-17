import { Settings } from 'lucide-react';
import { type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsPageSkeleton from '@/components/Skeleton/Settings/Page';
import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { SettingsTabs } from '@/store/global/initialState';

import { useCategory } from '../hooks/useCategory';

/**
 * Publishes the active settings tab's label as the page title. `fixedTab`
 * names the tab for explicit routes (e.g. `devices/:sub`) that carry no
 * `:tab` param.
 */
const createSettingsDynamicMeta = (fixedTab?: SettingsTabs) => {
  const SettingsDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
    const { t: tAuth } = useTranslation('auth');
    const groups = useCategory();
    const activeTab = (params.tab as SettingsTabs) || fixedTab || SettingsTabs.Profile;

    const label =
      activeTab === SettingsTabs.Profile
        ? tAuth('tab.profile')
        : groups.flatMap((group) => group.items).find((item) => item.key === activeTab)?.label;

    usePublishDynamicRouteMeta({ title: label || undefined }, onResolve);

    return null;
  };

  return SettingsDynamicMeta;
};

interface SettingsRouteMetaOptions {
  Skeleton?: ComponentType;
  /** The tab an explicit (non-`:tab`) route renders. */
  tab?: SettingsTabs;
}

/** Settings route meta; explicit tab routes pass their tab and page-shaped skeleton. */
export const createSettingsRouteMeta = ({ Skeleton, tab }: SettingsRouteMetaOptions = {}) =>
  routeMeta({
    DynamicMeta: createSettingsDynamicMeta(tab),
    icon: Settings,
    Skeleton: Skeleton ?? SettingsPageSkeleton,
    titleKey: 'navigation.settings',
  });

export const settingsRouteMeta = createSettingsRouteMeta();
