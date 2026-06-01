'use client';

import { Center } from '@lobehub/ui';
import { memo } from 'react';

import BrandWatermark from '@/components/BrandWatermark';

import Category from './features/Category';
import UserBanner from './features/UserBanner';

const MeHomePage = memo(() => {
  return (
    <>
      <UserBanner />
      <Category />
      <Center padding={16}>
        <BrandWatermark />
      </Center>
    </>
  );
});

MeHomePage.displayName = 'MeHomePage';

export default MeHomePage;
