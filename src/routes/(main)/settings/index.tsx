'use client';

import { memo } from 'react';
import { useMatches, useParams } from 'react-router-dom';

import { SettingsTabs } from '@/store/global/initialState';

import { type LayoutProps } from './_layout/type';
import SettingsContent from './features/SettingsContent';

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

  return <SettingsContent activeTab={activeTab} mobile={false} />;
});

Layout.displayName = 'DesktopSettingsLayout';

export default Layout;
