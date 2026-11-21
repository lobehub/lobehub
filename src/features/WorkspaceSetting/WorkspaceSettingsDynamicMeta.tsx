import { useTranslation } from 'react-i18next';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

import { useWorkspaceSettingCategory } from './hooks/useCategory';

interface WorkspaceSettingsDynamicMetaProps extends DynamicRouteMetaProps {
  tab: WorkspaceSettingsTabs;
}

/** Publishes the active workspace settings tab's label, as the content header shows it. */
const WorkspaceSettingsDynamicMeta = ({ onResolve, tab }: WorkspaceSettingsDynamicMetaProps) => {
  const { t } = useTranslation('auth');
  const categories = useWorkspaceSettingCategory();

  // The Profile nav item is labelled with the user's name; the title keeps the generic one.
  const label =
    tab === WorkspaceSettingsTabs.Profile
      ? t('profile.title')
      : categories.flatMap((category) => category.items).find((item) => item.key === tab)?.label;

  usePublishDynamicRouteMeta({ title: label || undefined }, onResolve);

  return null;
};

export default WorkspaceSettingsDynamicMeta;
