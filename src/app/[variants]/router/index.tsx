'use client';

import { useEffect, useState } from 'react';

import DesktopClientRouter from './DesktopClientRouter';

const useIsClient = () => {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);
  return isClient;
};
const DesktopRouter = () => {
  const isClient = useIsClient();
  if (!isClient) return null;
  return <DesktopClientRouter />;
};

export default DesktopRouter;
