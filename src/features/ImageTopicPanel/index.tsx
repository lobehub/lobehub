'use client';

import { type DraggablePanelProps } from '@lobehub/ui';
import { DraggablePanel, DraggablePanelContainer } from '@lobehub/ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type PropsWithChildren } from 'react';
import { memo, useEffect, useState } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const styles = createStaticStyles(({ css }) => ({
  content: css`
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  handle: css`
    background: ${cssVar.colorBgContainer} !important;
  `,
}));

const ImageTopicPanel = memo<PropsWithChildren>(({ children }) => {
  const { md = true } = useResponsive();
  const [imageTopicPanelWidth, showImageTopicPanel, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.imageTopicPanelWidth(s),
    systemStatusSelectors.showImageTopicPanel(s),
    s.updateSystemStatus,
  ]);

  const [tmpWidth, setWidth] = useState(imageTopicPanelWidth);
  if (tmpWidth !== imageTopicPanelWidth) setWidth(imageTopicPanelWidth);
  const [cacheExpand, setCacheExpand] = useState<boolean>(Boolean(showImageTopicPanel));

  const handleExpand = (expand: boolean) => {
    if (isEqual(expand, showImageTopicPanel)) return;
    updateSystemStatus({ showImageTopicPanel: expand });
    setCacheExpand(expand);
  };
  useEffect(() => {
    if (md && cacheExpand) updateSystemStatus({ showImageTopicPanel: true });
    if (!md) updateSystemStatus({ showImageTopicPanel: false });
  }, [md, cacheExpand]);

  const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
    if (!size) return;
    const nextWidth = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
    if (!nextWidth) return;

    if (isEqual(nextWidth, imageTopicPanelWidth)) return;
    setWidth(nextWidth);
    updateSystemStatus({ imageTopicPanelWidth: nextWidth });
  };

  return (
    <DraggablePanel
      defaultSize={{ width: tmpWidth }}
      expand={showImageTopicPanel}
      maxWidth={320}
      minWidth={80}
      mode={md ? 'fixed' : 'float'}
      placement="right"
      size={{ height: '100%', width: imageTopicPanelWidth }}
      classNames={{
        content: styles.content,
        handle: styles.handle,
      }}
      onExpandChange={handleExpand}
      onSizeChange={handleSizeChange}
    >
      <DraggablePanelContainer
        style={{
          flex: 'none',
          height: '100%',
          minWidth: 80,
        }}
      >
        {children}
      </DraggablePanelContainer>
    </DraggablePanel>
  );
});

export default ImageTopicPanel;
