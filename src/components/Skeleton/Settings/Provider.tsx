'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { useLocation } from 'react-router';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import { PROVIDER_MENU_WIDTH } from '@/features/Settings/provider/const';

import SkeletonBar from '../Bar';
import SkeletonList from '../NavPanel/List';
import SurfaceSkeleton from '../Surface';

const isProviderGridPath = (pathname: string) => /\/provider(?:\/all)?\/?$/.test(pathname);

export const ProviderDetailSkeleton = () => {
  const { pathname } = useLocation();

  return (
    <SurfaceSkeleton header={false} variant={isProviderGridPath(pathname) ? 'grid' : 'form'} />
  );
};

const ProviderSettingsSkeleton = () => (
  <Flexbox aria-busy horizontal height={'100%'} width={'100%'}>
    <Flexbox
      width={PROVIDER_MENU_WIDTH}
      style={{
        background: cssVar.colorBgContainer,
        borderRight: `1px solid ${cssVar.colorBorderSecondary}`,
        minWidth: PROVIDER_MENU_WIDTH,
      }}
    >
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        padding={8}
        style={{ borderBottom: `1px solid ${cssVar.colorBorderSecondary}`, marginBottom: 8 }}
      >
        <Flexbox flex={1}>
          <SkeletonBar height={32} />
        </Flexbox>
        <SkeletonBar height={28} width={28} />
      </Flexbox>
      <SkeletonList />
    </Flexbox>
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader />
      <SettingContainer maxWidth={1024} padding={24} style={{ minHeight: '100%' }}>
        <ProviderDetailSkeleton />
      </SettingContainer>
    </Flexbox>
  </Flexbox>
);

export default ProviderSettingsSkeleton;
