'use client';

import { Icon } from '@lobehub/ui';
import { HomeIcon } from 'lucide-react';
import { memo } from 'react';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useSettingsBreadcrumb } from '@/features/SettingsSwitch/useSettingsBreadcrumb';

import { useWorkspaceSettingsScope } from '../hooks/useWorkspaceSettingsScope';

const Header = memo(() => {
  const { activeTab, groups, scope, slug, space, tabUrl } = useWorkspaceSettingsScope();
  // "<Workspace> Settings", then "› Account Settings" in the account set.
  const breadcrumb = useSettingsBreadcrumb({
    activeTab,
    fallbackHref: `/${slug}/settings`,
    groups,
    scope,
    space,
    spaceKey: slug ?? '',
    tabUrl,
  });

  if (!slug) return null;

  return (
    <SideBarHeaderLayout
      breadcrumb={breadcrumb}
      homeItem={{ href: `/${slug}`, title: <Icon icon={HomeIcon} /> }}
    />
  );
});

export default Header;
