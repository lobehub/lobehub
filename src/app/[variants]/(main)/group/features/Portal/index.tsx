import { Suspense } from 'react';

import Portal from '@/app/[variants]/(main)/agent/features/Portal/features/Portal';
import PortalPanel from '@/app/[variants]/(main)/agent/features/Portal/features/PortalPanel';
import Loading from '@/components/Loading/BrandTextLoading';

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
