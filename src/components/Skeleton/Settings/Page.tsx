'use client';

import { Flexbox } from '@lobehub/ui';
import { useLocation } from 'react-router';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';

import SkeletonBar from '../Bar';
import SettingsProfileSkeleton from './Profile';
import SettingsSectionSkeleton from './Section';

const SettingsPageSkeleton = () => {
  const { pathname } = useLocation();
  const tab = pathname.match(/\/settings\/([^/]+)/)?.[1] ?? 'profile';
  const profile = tab === 'profile';

  return (
    <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      <NavHeader styles={{ center: { alignItems: 'center' } }}>
        <SkeletonBar height={16} width={profile ? 52 : 88} />
      </NavHeader>
      <SettingContainer maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
        {profile ? <SettingsProfileSkeleton /> : <SettingsSectionSkeleton />}
      </SettingContainer>
    </Flexbox>
  );
};

export default SettingsPageSkeleton;
