'use client';

import { createStaticStyles, DraggablePanel } from '@lobehub/ui';
import { lazy, memo, Suspense, useState } from 'react';

import { CHAT_PORTAL_TOOL_UI_WIDTH } from '@/const/layoutTokens';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import ShareLoading from '../../shell/ShareLoading';

const styles = createStaticStyles(({ cssVar, css }) => ({
  body: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    height: 0;
    padding-block-end: 12px;
  `,
  content: css`
    position: relative;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    height: 100%;
    min-height: 100%;
    max-height: 100%;

    background: ${cssVar.colorBgContainer};
  `,
  drawer: css`
    z-index: 10;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
}));

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
      className={styles.drawer}
      classNames={{ content: styles.content }}
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
          <PortalContent renderBody={(body) => <div className={styles.body}>{body}</div>} />
        </Suspense>
      )}
    </DraggablePanel>
  );
});

SharePortal.displayName = 'SharePortal';

export default SharePortal;
