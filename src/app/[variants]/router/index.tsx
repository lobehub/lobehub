'use client';

import dynamic from 'next/dynamic';

import Loading from '@/components/Loading/BrandTextLoading';

const DesktopRouterClient = dynamic(() => import('./DesktopClientRouter'), {
  loading: () => <Loading debugId="DesktopRouter" />,
  ssr: false,
});

const DesktopRouter = () => {
  return <DesktopRouterClient />;
};

export default DesktopRouter;
