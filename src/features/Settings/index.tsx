'use client';

import { memo } from 'react';
import { useMatches, useParams } from 'react-router';

import { SettingsTabs } from '@/store/global/initialState';
import { isMobileSurface } from '@/utils/mobileSurface';

import SettingsContent from './features/SettingsContent';
import { type LayoutProps } from './Layout/type';

interface SettingsRouteHandle {
  settingsTab?: SettingsTabs;
}

const isSettingsRouteHandle = (handle: unknown): handle is SettingsRouteHandle => {
  return typeof handle === 'object' && handle !== null && 'settingsTab' in handle;
};

const getSettingsTabFromMatches = (matches: ReturnType<typeof useMatches>) => {
  for (const match of [...matches].reverse()) {
    const { handle } = match;
    if (isSettingsRouteHandle(handle) && handle.settingsTab) return handle.settingsTab;
  }
};

const Layout = memo<LayoutProps>(() => {
  const params = useParams<{ tab?: string }>();
  const matches = useMatches();

  const activeTab =
    (params.tab as SettingsTabs | undefined) ||
    getSettingsTabFromMatches(matches) ||
    SettingsTabs.Profile;

  // The mobile settings layout already owns the header and back button; the
  // mobile branch renders the tab body only.
  return <SettingsContent activeTab={activeTab} mobile={isMobileSurface()} />;
});

Layout.displayName = 'SettingsLayout';

export default Layout;
