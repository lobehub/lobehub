'use client';

import Loading from '@/components/Loading/BrandTextLoading';
import dynamic from '@/libs/next/dynamic';

const MobileRouterClient = dynamic(() => import('./MobileClientRouter'), {
  loading: () => <Loading debugId="MobileRouter" />,
  ssr: false,
});

const MobileRouter = () => {
  return <MobileRouterClient />;
};

export default MobileRouter;
