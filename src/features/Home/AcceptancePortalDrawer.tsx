'use client';

import { Flexbox } from '@lobehub/ui';
import { Drawer } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { PortalContent } from '@/features/Portal/router';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { isAcceptancePortalView } from './acceptancePortalView';

/**
 * Home has no persistent chat portal column. Internal acceptance links still
 * use the shared portal stack, so host that content in a right-side drawer and
 * keep the user anchored in the inbox report they were reading.
 */
const AcceptancePortalDrawer = memo(() => {
  const [viewType, clearPortalStack] = useChatStore((state) => [
    chatPortalSelectors.currentViewType(state),
    state.clearPortalStack,
  ]);
  const open = isAcceptancePortalView(viewType);

  return (
    <Drawer
      noHeader
      closable={false}
      containerMaxWidth={'100%'}
      open={open}
      placement={'right'}
      width={'min(960px, 92vw)'}
      styles={{
        bodyContent: { height: '100%', minHeight: 0, overflow: 'hidden', padding: 0 },
      }}
      onClose={clearPortalStack}
    >
      {open && (
        <Flexbox height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
          <PortalContent />
        </Flexbox>
      )}
    </Drawer>
  );
});

AcceptancePortalDrawer.displayName = 'AcceptancePortalDrawer';

export default AcceptancePortalDrawer;
