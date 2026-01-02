'use client';

import { memo } from 'react';

import Category from './features/Category';

const MeSettingsPage = memo(() => {
  return <Category />;
});

MeSettingsPage.displayName = 'MeSettingsPage';

export default MeSettingsPage;
