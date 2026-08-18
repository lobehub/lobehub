import { Suspense } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import Portal from '@/routes/(main)/agent/features/Portal/features/Portal';
import PortalPanel from '@/routes/(main)/agent/features/Portal/features/PortalPanel';

const ChatPortal = () => {
  return (
    <Portal>
      <Suspense fallback={<SurfaceSkeleton header={false} variant={'list'} />}>
        <PortalPanel mobile={false} />
      </Suspense>
    </Portal>
  );
};

export default ChatPortal;
