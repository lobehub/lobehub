'use client';

import { type FC, type PropsWithChildren } from 'react';

import { useMounted } from '@/hooks/useMounted';

const ClientOnly: FC<PropsWithChildren> = ({ children }) => {
  const mounted = useMounted();

  if (!mounted) return null;

  return children;
};

export default ClientOnly;
