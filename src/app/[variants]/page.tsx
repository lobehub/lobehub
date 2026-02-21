import Loading from '@/components/Loading/BrandTextLoading';
import dynamic from '@/libs/next/dynamic';
import { type DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

import DesktopRouter from './router';

const MobileRouter = dynamic(() => import('./(mobile)'), {
  loading: () => <Loading debugId={'Root'} />,
});

export default async (props: DynamicLayoutProps) => {
  // Get isMobile from variants parameter on server side
  const isMobile = await RouteVariants.getIsMobile(props);

  // Conditionally load and render based on device type
  // Using native dynamic import ensures complete code splitting
  // Mobile and Desktop bundles will be completely separate

  if (isMobile) return <MobileRouter />;

  return <DesktopRouter />;
};
