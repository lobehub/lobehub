'use client';

import { memo, type PropsWithChildren } from 'react';

import { useAuthServerConfigStore } from '@/features/AuthShell';

import NotFound from './NotFound';

const OAuthGuard = memo<PropsWithChildren>(({ children }) => {
  const enableOIDC = useAuthServerConfigStore((s) => s.enableOIDC);

  if (!enableOIDC) return <NotFound />;

  return children;
});

OAuthGuard.displayName = 'OAuthGuard';

export default OAuthGuard;
