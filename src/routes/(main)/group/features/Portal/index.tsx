import { Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import Portal from '@/routes/(main)/agent/features/Portal/features/Portal';
import PortalPanel from '@/routes/(main)/agent/features/Portal/features/PortalPanel';

const ChatPortal = () => {
  return (
    <Portal>
      <Suspense fallback={<Loading debugId={'ChatPortal'} />}>
        <PortalPanel mobile={false} />
      </Suspense>
    </Portal>
  );
};

export default ChatPortal;
