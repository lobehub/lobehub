'use client';

import { Center } from '@lobehub/ui';

import BrandWatermark from '@/components/BrandWatermark';

import Category from './features/Category';
import UserBanner from './features/UserBanner';

const MeHomePage = () => {
  return (
    <>
      <UserBanner />
      <Category />
      <Center padding={16}>
        <BrandWatermark />
      </Center>
    </>
  );
};

export default MeHomePage;
