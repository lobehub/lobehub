import { memo, Suspense } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';

import DesktopLayout from '../_layout/Desktop';
import MobileLayout from '../_layout/Mobile';

interface PortalPanelProps {
  mobile?: boolean;
}

const PortalPanel = memo<PortalPanelProps>(({ mobile }) => {
  const Layout = mobile ? MobileLayout : DesktopLayout;

  return (
    <Suspense fallback={<SurfaceSkeleton header={false} variant={'list'} />}>
      <Layout />
    </Suspense>
  );
});

PortalPanel.displayName = 'PortalPanel';

export default PortalPanel;
