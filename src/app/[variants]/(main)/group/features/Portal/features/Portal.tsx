'use client';

import { DraggablePanel, DraggablePanelContainer, type DraggablePanelProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Activity, type PropsWithChildren, memo, useState } from 'react';

import {
  CHAT_PORTAL_MAX_WIDTH,
  CHAT_PORTAL_TOOL_UI_WIDTH,
  CHAT_PORTAL_WIDTH,
} from '@/const/layoutTokens';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, portalThreadSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    display: flex;
    flex-direction: column;
    height: 100% !important;
  `,
  drawer: css`
    z-index: 10;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  panel: css`
    overflow: hidden;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
}));

const PortalPanel = memo(({ children }: PropsWithChildren) => {
  const { md = true } = useResponsive();

  const [showPortal, showToolUI, showArtifactUI, showThread] = useChatStore((s) => [
    chatPortalSelectors.showPortal(s),
    chatPortalSelectors.showPluginUI(s),
    chatPortalSelectors.showArtifactUI(s),
    portalThreadSelectors.showThread(s),
  ]);

  const [portalWidth, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.portalWidth(s),
    s.updateSystemStatus,
  ]);

  const [tmpWidth, setWidth] = useState(portalWidth);
  if (tmpWidth !== portalWidth) setWidth(portalWidth);

  const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
    if (!size) return;
    const nextWidth = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
    if (!nextWidth) return;

    if (isEqual(nextWidth, portalWidth)) return;
    setWidth(nextWidth);
    updateSystemStatus({ portalWidth: nextWidth });
  };

  return (
    <DraggablePanel
      className={styles.drawer}
      classNames={{
        content: styles.content,
      }}
      defaultSize={{ width: tmpWidth }}
      expand={showPortal}
      maxWidth={CHAT_PORTAL_MAX_WIDTH}
      minWidth={
        (showArtifactUI || showToolUI || showThread) && md
          ? CHAT_PORTAL_TOOL_UI_WIDTH
          : CHAT_PORTAL_WIDTH
      }
      mode={md ? 'fixed' : 'float'}
      onSizeChange={handleSizeChange}
      placement={'right'}
      showHandleWhenCollapsed={false}
      showHandleWideArea={false}
      size={{ height: '100%', width: portalWidth }}
      styles={{
        handle: { display: 'none' },
      }}
    >
      <DraggablePanelContainer
        style={{
          flex: 'none',
          height: '100%',
          maxHeight: '100vh',
          minWidth: CHAT_PORTAL_WIDTH,
        }}
      >
        <Activity mode={showPortal ? 'visible' : 'hidden'} name="GroupPortal">
          <Flexbox className={styles.panel}>{children}</Flexbox>
        </Activity>
      </DraggablePanelContainer>
    </DraggablePanel>
  );
});

export default PortalPanel;
