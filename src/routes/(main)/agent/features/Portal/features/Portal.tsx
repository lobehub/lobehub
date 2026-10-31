'use client';

import { DraggablePanel, type DraggablePanelProps } from '@lobehub/ui';
import { useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type PropsWithChildren } from 'react';
import { Activity, memo, useState } from 'react';

import { useTopicDrawerPortalHostViewType } from '@/features/AgentTasks/hooks/useTopicDrawerArtifactPortal';
import { usePortalPanelWidth } from '@/features/Portal/usePortalPanelWidth';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, portalThreadSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

const styles = stylex.create({
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

const PortalPanel = memo(({ children }: PropsWithChildren) => {
  const [showPortal, showThread] = useChatStore((s) => [
    chatPortalSelectors.showStandalonePortal(s),
    portalThreadSelectors.showThread(s),
  ]);
  const currentViewType = useTopicDrawerPortalHostViewType();

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
      className={stylex.props(styles.drawer).className}
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
        content: stylex.props(styles.content).className,
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
