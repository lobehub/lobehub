'use client';

import dynamic from '@/libs/next/dynamic';

import Loading from '@/components/Loading/BrandTextLoading';

const MobileRouterClient = dynamic(() => import('./MobileClientRouter'), {
  loading: () => <Loading debugId="MobileRouter" />,
  ssr: false,
});

const MobileRouter = () => {
  return <MobileRouterClient />;
};

export default MobileRouter;
