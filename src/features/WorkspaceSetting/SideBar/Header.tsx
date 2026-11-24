'use client';

import { Icon } from '@lobehub/ui';
import { HomeIcon } from 'lucide-react';
import { memo } from 'react';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useSettingsScopeTitle } from '@/features/SettingsSwitch/useSettingsScopeTitle';

import { useWorkspaceSettingsScope } from '../hooks/useWorkspaceSettingsScope';

const Header = memo(() => {
  const { groups, scope, slug, space, tabUrl } = useWorkspaceSettingsScope();
  // "Account Settings" or "<Workspace> Settings", following the visible set.
  const title = useSettingsScopeTitle(scope, space);
  const firstTab = groups.find((group) => group.scope === scope)?.items[0]?.key;

  if (!slug) return null;

  return (
    <SideBarHeaderLayout
      breadcrumb={[{ href: firstTab ? tabUrl(firstTab) : `/${slug}/settings`, title }]}
      homeItem={{ href: `/${slug}`, title: <Icon icon={HomeIcon} /> }}
    />
  );
});

export default Header;
