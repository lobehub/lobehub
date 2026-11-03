import { Suspense } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';

import Portal from './features/Portal';
import PortalPanel from './features/PortalPanel';

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
