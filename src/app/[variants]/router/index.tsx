'use client';

import Loading from '@/components/Loading/BrandTextLoading';
import dynamic from '@/libs/next/dynamic';

const DesktopRouterClient = dynamic(() => import('./DesktopClientRouter'), {
  loading: () => <Loading debugId="DesktopRouter" />,
  ssr: false,
});

const DesktopRouter = () => {
  return <DesktopRouterClient />;
};

export default DesktopRouter;
