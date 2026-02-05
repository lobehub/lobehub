import { memo,Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';

import DesktopLayout from '../_layout/Desktop';
import MobileLayout from '../_layout/Mobile';

interface PortalPanelProps {
  mobile?: boolean;
}

const PortalPanel = memo<PortalPanelProps>(({ mobile }) => {
  const Layout = mobile ? MobileLayout : DesktopLayout;

  return (
    <Suspense fallback={<Loading debugId="PortalPanel" />}>
      <Layout />
    </Suspense>
  );
});

PortalPanel.displayName = 'PortalPanel';

export default PortalPanel;
