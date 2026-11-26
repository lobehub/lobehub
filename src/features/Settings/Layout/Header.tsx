'use client';

import { memo } from 'react';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useSettingsBreadcrumb } from '@/features/SettingsSwitch/useSettingsBreadcrumb';

import {
  PERSONAL_SETTINGS_SPACE_KEY,
  usePersonalSettingsScope,
} from '../hooks/usePersonalSettingsScope';

const PERSONAL_SPACE = { kind: 'personal' } as const;

const Header = memo(() => {
  const { activeTab, categoryGroups, scope, tabUrl } = usePersonalSettingsScope();
  // "Personal Space Settings", then "› Account Settings" in the account set.
  const breadcrumb = useSettingsBreadcrumb({
    activeTab,
    fallbackHref: '/settings',
    groups: categoryGroups,
    scope,
    space: PERSONAL_SPACE,
    spaceKey: PERSONAL_SETTINGS_SPACE_KEY,
    tabUrl,
  });

  return <SideBarHeaderLayout breadcrumb={breadcrumb} />;
});

export default Header;
