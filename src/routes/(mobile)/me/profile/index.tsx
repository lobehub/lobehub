'use client';

import { memo } from 'react';

import Category from './features/Category';

const MeProfilePage = memo(() => {
  return <Category />;
});

MeProfilePage.displayName = 'MeProfilePage';

export default MeProfilePage;
