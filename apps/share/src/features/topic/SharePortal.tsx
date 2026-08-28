'use client';

import { DraggablePanel } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { CHAT_PORTAL_TOOL_UI_WIDTH } from '@/const/layoutTokens';
import { PortalContent } from '@/features/Portal/router';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

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

const SharePortal = memo(() => {
  const showPortal = useChatStore(chatPortalSelectors.showPortal);

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
      <PortalContent renderBody={(body) => <div className={styles.body}>{body}</div>} />
    </DraggablePanel>
  );
});

SharePortal.displayName = 'SharePortal';

export default SharePortal;
