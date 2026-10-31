'use client';

import { DraggablePanel } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { lazy, memo, Suspense, useState } from 'react';

import { CHAT_PORTAL_TOOL_UI_WIDTH } from '@/const/layoutTokens';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import ShareLoading from '../../shell/ShareLoading';

const styles = stylex.create({
  body: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    height: '0',
    paddingBlockEnd: '12px',
  },
  content: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: '100%',
    maxHeight: '100%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  drawer: {
    zIndex: 10,
    height: '100%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

// Every portal view (artifacts, documents, tasks, goals…) ships with the router,
// about 1MB gzipped, for a panel that starts collapsed. Loading it on first open
// keeps it off the download the transcript waits for.
const PortalContent = lazy(() =>
  import('@/features/Portal/router').then((module) => ({ default: module.PortalContent })),
);

const SharePortal = memo(() => {
  const showPortal = useChatStore(chatPortalSelectors.showPortal);
  // Latched: once opened the content stays mounted, as it always has, so
  // closing the panel animates out with its view instead of an empty body.
  const [opened, setOpened] = useState(showPortal);
  if (showPortal && !opened) setOpened(true);

  return (
    <DraggablePanel
      className={stylex.props(styles.drawer).className}
      classNames={{ content: stylex.props(styles.content).className }}
      defaultSize={{ width: CHAT_PORTAL_TOOL_UI_WIDTH }}
      expand={showPortal}
      expandable={false}
      minWidth={CHAT_PORTAL_TOOL_UI_WIDTH}
      placement="right"
      showHandleWhenCollapsed={false}
      showHandleWideArea={false}
      size={{ height: '100%', width: CHAT_PORTAL_TOOL_UI_WIDTH }}
    >
      {opened && (
        <Suspense fallback={<ShareLoading />}>
          <PortalContent renderBody={(body) => <div {...stylex.props(styles.body)}>{body}</div>} />
        </Suspense>
      )}
    </DraggablePanel>
  );
});

SharePortal.displayName = 'SharePortal';

export default SharePortal;
