'use client';

import { memo } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Toast from './Toast';

const ZenModeToast = memo(() => {
  const inZenMode = useGlobalStore(systemStatusSelectors.inZenMode);

  return inZenMode && <Toast />;
});

export default ZenModeToast;
