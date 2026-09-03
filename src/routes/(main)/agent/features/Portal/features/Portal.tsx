'use client';

import { type DraggablePanelProps } from '@lobehub/ui';
import { DraggablePanel } from '@lobehub/ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import { type PropsWithChildren } from 'react';
import { Activity, memo, useState } from 'react';

import { usePortalPanelWidth } from '@/features/Portal/usePortalPanelWidth';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, portalThreadSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

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

  const { maxWidth, minWidth, updateWidth, width: portalWidth } = usePortalPanelWidth(viewType);

  const [tmpWidth, setWidth] = useState(portalWidth);
  if (tmpWidth !== portalWidth) setWidth(portalWidth);

  const { lg } = useResponsive();

  const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
    if (!size) return;
    const nextWidth = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
    if (!nextWidth || nextWidth === portalWidth) return;

    setWidth(nextWidth);
    updateWidth(nextWidth);
  };

  return (
    <DraggablePanel
      className={styles.drawer}
      defaultSize={{ width: tmpWidth }}
      expand={showPortal}
      expandable={false}
      maxWidth={maxWidth}
      minWidth={minWidth}
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
