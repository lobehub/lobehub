'use client';

import { type DraggablePanelProps } from '@lobehub/ui';
import { DraggablePanel } from '@lobehub/ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type PropsWithChildren } from 'react';
import { Activity, memo, useState } from 'react';

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

const PortalPanel = memo(({ children }: PropsWithChildren) => {
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

  const { lg } = useResponsive();

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
      defaultSize={{ width: tmpWidth }}
      expand={showPortal}
      expandable={false}
      maxWidth={CHAT_PORTAL_MAX_WIDTH}
      mode={lg ? 'fixed' : 'float'}
      placement={'right'}
      showHandleWhenCollapsed={false}
      showHandleWideArea={false}
      size={{ height: '100%', width: portalWidth }}
      classNames={{
        content: styles.content,
      }}
      minWidth={
        showArtifactUI || showToolUI || showThread ? CHAT_PORTAL_TOOL_UI_WIDTH : CHAT_PORTAL_WIDTH
      }
      onSizeChange={handleSizeChange}
    >
      <Activity mode={showPortal ? 'visible' : 'hidden'} name="AgentPortal">
        {children}
      </Activity>
    </DraggablePanel>
  );
});

export default PortalPanel;
