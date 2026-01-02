'use client';

import { cssVar } from 'antd-style';
import NextTopLoader from 'nextjs-toploader';
import { memo } from 'react';

import { isDesktop } from '@/const/version';

const NProgress = memo(() => {
  return (
    !isDesktop && (
      <NextTopLoader
        color={cssVar.colorText}
        height={2}
        shadow={false}
        showSpinner={false}
        zIndex={1000}
      />
    )
  );
});

export default NProgress;
