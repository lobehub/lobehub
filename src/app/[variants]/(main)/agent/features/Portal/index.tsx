import { Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';

import Portal from './features/Portal';
import PortalPanel from './features/PortalPanel';

const ChatPortal = () => {
  return (
    <Portal>
      <Suspense fallback={<Loading debugId={'ChatPortal'} />}>
        <PortalPanel mobile={false} />
      </Suspense>
    </Portal>
  );
};

ChatPortal.displayName = 'ChatPortal';

export default ChatPortal;
