'use client';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import Footer from '@/features/Setting/Footer';
import SettingsContent from '@/features/Settings/features/SettingsContent';
import { parseAsString, useQueryState } from '@/hooks/useQueryParam';
import { SettingsTabs } from '@/store/global/initialState';

import Header from './_layout/Header';

const Layout = () => {
  const [activeTab] = useQueryState('active', parseAsString.withDefault(SettingsTabs.Profile));

  return (
    <MobileContentLayout header={<Header />}>
      <SettingsContent activeTab={activeTab} mobile={true} />
      <Footer />
    </MobileContentLayout>
  );
};

export default Layout;
