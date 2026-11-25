'use client';

import { memo } from 'react';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useSettingsScopeTitle } from '@/features/SettingsSwitch/useSettingsScopeTitle';

import { usePersonalSettingsScope } from '../hooks/usePersonalSettingsScope';

const PERSONAL_SPACE = { kind: 'personal' } as const;

const Header = memo(() => {
  const { categoryGroups, scope, tabUrl } = usePersonalSettingsScope();
  const title = useSettingsScopeTitle(scope, PERSONAL_SPACE);
  const firstTab = categoryGroups.find((group) => group.scope === scope)?.items[0]?.key;

  return (
    <SideBarHeaderLayout
      breadcrumb={[
        {
          href: firstTab ? tabUrl(firstTab) : '/settings',
          title,
        },
      ]}
    />
  );
});

export default Header;
