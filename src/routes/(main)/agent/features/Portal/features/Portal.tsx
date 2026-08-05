'use client';

import { type DraggablePanelProps } from '@lobehub/ui';
import { DraggablePanel } from '@lobehub/ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type PropsWithChildren } from 'react';
import { Activity, memo, useState } from 'react';

import { CHAT_PORTAL_MAX_WIDTH } from '@/const/layoutTokens';
import { getPortalViewMinWidth, getPortalViewWidth } from '@/features/Portal/portalWidth';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, portalThreadSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
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
  const [showPortal, currentViewType, showThread] = useChatStore((s) => [
    chatPortalSelectors.showStandalonePortal(s),
    chatPortalSelectors.currentViewType(s),
    portalThreadSelectors.showThread(s),
  ]);

  // legacy threads live outside the view stack, so they surface as an empty stack
  const viewType = currentViewType ?? (showThread ? PortalViewType.Thread : null);

  const [legacyWidth, portalWidths, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.portalWidth(s),
    systemStatusSelectors.portalWidths(s),
    s.updateSystemStatus,
  ]);

  const portalWidth = getPortalViewWidth({ legacyWidth, viewType, widths: portalWidths });

  const [tmpWidth, setWidth] = useState(portalWidth);
  if (tmpWidth !== portalWidth) setWidth(portalWidth);

  const { lg } = useResponsive();

  const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
    if (!size) return;
    const nextWidth = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
    if (!nextWidth) return;

    if (isEqual(nextWidth, portalWidth)) return;
    setWidth(nextWidth);
    // updateSystemStatus deep-merges, so the other views keep their widths
    updateSystemStatus({ portalWidths: { [viewType ?? PortalViewType.Home]: nextWidth } });
  };

  return (
    <DraggablePanel
      className={styles.drawer}
      defaultSize={{ width: tmpWidth }}
      expand={showPortal}
      expandable={false}
      maxWidth={CHAT_PORTAL_MAX_WIDTH}
      minWidth={getPortalViewMinWidth(viewType)}
      mode={lg ? 'fixed' : 'float'}
      placement={'right'}
      showHandleWhenCollapsed={false}
      showHandleWideArea={false}
      size={{ height: '100%', width: portalWidth }}
      classNames={{
        content: styles.content,
      }}
      onSizeChange={handleSizeChange}
    >
      <Activity mode={showPortal ? 'visible' : 'hidden'} name="AgentPortal">
        {children}
      </Activity>
    </DraggablePanel>
  );
});

export default PortalPanel;
