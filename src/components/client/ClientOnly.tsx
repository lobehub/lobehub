'use client';

import type React from 'react';
import { type FC, type PropsWithChildren, useEffect, useState } from 'react';

const ClientOnly: FC<PropsWithChildren<{ fallback?: React.ReactNode }>> = ({
  children,
  fallback = null,
}) => {
  const [mounted, setMounted] = useState(false);

const ClientOnly: FC<PropsWithChildren> = ({ children }) => {
  const mounted = useMounted();

  if (!mounted) return fallback;

  return children;
};

export default ClientOnly;
