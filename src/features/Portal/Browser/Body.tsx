import { Flexbox } from '@lobehub/ui';
import { lazy, memo, Suspense } from 'react';

import type { ComposerTarget } from '@/features/Conversation/types/composerTarget';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

const BrowserPane = lazy(() => import('@/features/Conversation/WorkingSidebar/Browser'));

// The Portal sits beside a host's own composer, not inside a conversation, so the
// screenshot and element-pick actions have nowhere to send their result.
const NO_COMPOSER: ComposerTarget = { reason: 'no-composer', writable: false };

const Body = memo(() => {
  const view = useChatStore(chatPortalSelectors.browserPortal);
  const replacePortalView = useChatStore((s) => s.replacePortalView);

  if (!view) return null;

  return (
    <Flexbox flex={1} style={{ minHeight: 0 }}>
      <Suspense fallback={null}>
        <BrowserPane
          composerTarget={NO_COMPOSER}
          key={view.sessionId}
          request={view.request ?? null}
          sessionId={view.sessionId}
          onRequestConsumed={() =>
            replacePortalView({ sessionId: view.sessionId, type: PortalViewType.Browser })
          }
        />
      </Suspense>
    </Flexbox>
  );
});

export default Body;
