'use client';

import { memo } from 'react';

import { ScopeSwitchFooter } from '@/features/SettingsSwitch';

import { useWorkspaceSettingsScope } from '../hooks/useWorkspaceSettingsScope';

/** Switches `/:slug/settings/*` between account settings and this workspace's settings. */
const Footer = memo(() => {
  const { slug, space, switchScope, switchUrl } = useWorkspaceSettingsScope();

  if (!slug) return null;

  return <ScopeSwitchFooter space={space} switchScope={switchScope} switchUrl={switchUrl} />;
});

Footer.displayName = 'WorkspaceSettingsSidebarFooter';

export default Footer;
