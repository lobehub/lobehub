'use client';

import { type FC, type PropsWithChildren, useEffect, useState } from 'react';

const ClientOnly: FC<PropsWithChildren> = ({ children }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return children;
};

export default ClientOnly;
