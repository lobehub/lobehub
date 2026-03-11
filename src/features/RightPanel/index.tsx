import { type DraggablePanelProps } from '@lobehub/ui';
import { DraggablePanel } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, Suspense, useState } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export interface Size {
  height?: string | number;
  width?: string | number;
}

interface RightPanelProps extends Omit<
  DraggablePanelProps,
  'placement' | 'size' | 'onSizeChange' | 'onExpandChange'
> {
  defaultWidth?: number | string;
  onSizeChange?: (size?: Size) => void;
}

const RightPanel = memo<RightPanelProps>(
  ({ maxWidth = 600, minWidth = 300, children, defaultWidth = 360, onSizeChange, ...rest }) => {
    const [showRightPanel, toggleRightPanel] = useGlobalStore((s) => [
      systemStatusSelectors.showRightPanel(s),
      s.toggleRightPanel,
    ]);

    const [width, setWidth] = useState<string | number>(defaultWidth);

    return (
      <DraggablePanel
        backgroundColor={cssVar.colorBgContainer}
        expand={showRightPanel}
        expandable={false}
        maxWidth={maxWidth}
        minWidth={minWidth}
        placement="right"
        size={{
          height: '100%',
          width,
        }}
        onExpandChange={(expand) => toggleRightPanel(expand)}
        onSizeChange={(_, size) => {
          if (size?.width) {
            setWidth(size.width);
          }
          if (size) onSizeChange?.(size);
        }}
        {...rest}
      >
        <Suspense fallback={<Loading debugId={'RightPanel'} />}>{children}</Suspense>
      </DraggablePanel>
    );
  },
);

export default RightPanel;
