'use client';

import { Skeleton } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { enableClerk } from '@/envs/auth';
import dynamic from '@/libs/next/dynamic';

const ClerkProfile = dynamic(() => import('./features/ClerkProfile'), {
  loading: () => (
    <div style={{ flex: 1 }}>
      <Skeleton paragraph={{ rows: 8 }} title={false} />
    </div>
  ),
});

const Page = () => {
  const { t } = useTranslation('setting');
  if (!enableClerk) return <Navigate replace to="/settings" />;
  return (
    <>
      <SettingHeader title={t('tab.security')} />
      <ClerkProfile />
    </>
  );
};

export default Page;
