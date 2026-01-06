'use client';

import { useMounted } from '@/hooks/useMounted';

import DesktopClientRouter from './DesktopClientRouter';

const DesktopRouter = () => {
  const isClient = useMounted();
  if (!isClient) return null;
  return <DesktopClientRouter />;
};

export default DesktopRouter;
