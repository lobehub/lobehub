'use client';

import { memo } from 'react';

import { ScopeSwitchFooter } from '@/features/SettingsSwitch';

import { usePersonalSettingsScope } from '../hooks/usePersonalSettingsScope';

const PERSONAL_SPACE = { kind: 'personal' } as const;

/** Switches `/settings/*` between account settings and personal space settings. */
const Footer = memo(() => {
  const { switchScope, switchUrl } = usePersonalSettingsScope();

  return (
    <ScopeSwitchFooter space={PERSONAL_SPACE} switchScope={switchScope} switchUrl={switchUrl} />
  );
});

Footer.displayName = 'SettingsSidebarFooter';

export default Footer;
