import { DraggablePanel, type DraggablePanelProps } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Suspense, memo, useState } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

interface RightPanelProps extends Omit<
  DraggablePanelProps,
  'placement' | 'size' | 'onSizeChange' | 'onExpandChange'
> {
  defaultWidth?: number | string;
}

const RightPanel = memo<RightPanelProps>(
  ({ maxWidth = 600, minWidth = 300, children, defaultWidth = 360, ...rest }) => {
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
        onExpandChange={(expand) => toggleRightPanel(expand)}
        onSizeChange={(_, size) => {
          if (size?.width) setWidth(size.width);
        }}
        placement="right"
        size={{
          height: '100%',
          width,
        }}
        {...rest}
      >
        <Suspense fallback={<Loading debugId={'RightPanel'} />}>{children}</Suspense>
      </DraggablePanel>
    );
  },
);

export default RightPanel;
