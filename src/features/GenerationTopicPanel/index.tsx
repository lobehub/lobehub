'use client';

import { DraggablePanel, DraggablePanelContainer, type DraggablePanelProps } from '@lobehub/ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type PropsWithChildren, memo, useEffect, useState } from 'react';

export const styles = createStaticStyles(({ css }) => ({
  content: css`
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  handle: css`
    background: ${cssVar.colorBgContainer} !important;
  `,
}));

interface GenerationTopicPanelProps extends PropsWithChildren {
  onExpandChange: (expand: boolean) => void;
  onSizeChange: (width: number) => void;
  panelWidth: number;
  showPanel: boolean;
}

const GenerationTopicPanel = memo<GenerationTopicPanelProps>(
  ({ children, panelWidth, showPanel, onExpandChange, onSizeChange }) => {
    const { md = true } = useResponsive();

    const [tmpWidth, setWidth] = useState(panelWidth);
    if (tmpWidth !== panelWidth) setWidth(panelWidth);
    const [cacheExpand, setCacheExpand] = useState<boolean>(Boolean(showPanel));

    const handleExpand = (expand: boolean) => {
      if (isEqual(expand, showPanel)) return;
      onExpandChange(expand);
      setCacheExpand(expand);
    };

    useEffect(() => {
      if (md && cacheExpand) onExpandChange(true);
      if (!md) onExpandChange(false);
    }, [md, cacheExpand]);

    const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
      if (!size) return;
      const nextWidth = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
      if (!nextWidth) return;

      if (isEqual(nextWidth, panelWidth)) return;
      setWidth(nextWidth);
      onSizeChange(nextWidth);
    };

    return (
      <DraggablePanel
        classNames={{
          content: styles.content,
          handle: styles.handle,
        }}
        defaultSize={{ width: tmpWidth }}
        expand={showPanel}
        maxWidth={320}
        minWidth={80}
        mode={md ? 'fixed' : 'float'}
        onExpandChange={handleExpand}
        onSizeChange={handleSizeChange}
        placement="right"
        size={{ height: '100%', width: panelWidth }}
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
  },
);

GenerationTopicPanel.displayName = 'GenerationTopicPanel';

export default GenerationTopicPanel;
