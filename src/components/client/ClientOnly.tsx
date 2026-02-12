'use client';

import type React from 'react';
import { type FC, type PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';

const ClientOnly: FC<PropsWithChildren<{ fallback?: React.ReactNode }>> = ({
  children,
  fallback = null,
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return fallback;

  return children;
};

export default ClientOnly;
