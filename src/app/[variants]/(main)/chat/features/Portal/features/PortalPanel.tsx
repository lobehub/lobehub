import { Suspense, memo } from 'react';

import DesktopLayout from '@/app/[variants]/(main)/chat/features/Portal/_layout/Desktop';
import MobileLayout from '@/app/[variants]/(main)/chat/features/Portal/_layout/Mobile';
import Loading from '@/components/Loading/BrandTextLoading';

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
