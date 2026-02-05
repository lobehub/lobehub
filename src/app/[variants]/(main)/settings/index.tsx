'use client';

import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { SettingsTabs } from '@/store/global/initialState';

import type {LayoutProps} from './_layout/type';
import SettingsContent from './features/SettingsContent';

const Layout = memo<LayoutProps>(() => {
  const params = useParams<{ tab?: string }>();

  const activeTab = (params.tab as SettingsTabs) || SettingsTabs.Profile;

  return <SettingsContent activeTab={activeTab} mobile={false} />;
});

Layout.displayName = 'DesktopSettingsLayout';

export default Layout;
