'use client';

import { memo, type PropsWithChildren } from 'react';

import NotFound from '@/components/404';
import { useAuthServerConfigStore } from '@/features/AuthShell';

const OAuthGuard = memo<PropsWithChildren>(({ children }) => {
  const enableOIDC = useAuthServerConfigStore((s) => s.enableOIDC);

  if (!enableOIDC) return <NotFound />;

  return children;
});

OAuthGuard.displayName = 'OAuthGuard';

export default OAuthGuard;
