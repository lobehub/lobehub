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
  'placement' | 'size' | 'onSizeChange' | 'onExpandChange' | 'expand'
> {
  defaultWidth?: number | string;
  /**
   * Override the panel's expanded state. When provided together with `onExpandChange`,
   * the panel uses these instead of the global `showRightPanel` store. This lets each
   * surface (Page editor, Task layout, etc.) own an independent visibility state.
   */
  expand?: boolean;
  onExpandChange?: (expand: boolean) => void;
  onSizeChange?: (size?: Size) => void;
}

const RightPanel = memo<RightPanelProps>(
  ({
    maxWidth = 600,
    minWidth = 300,
    children,
    defaultWidth = 360,
    expand: expandProp,
    onExpandChange,
    onSizeChange,
    ...rest
  }) => {
    const [globalExpand, globalToggle] = useGlobalStore((s) => [
      systemStatusSelectors.showRightPanel(s),
      s.toggleRightPanel,
    ]);

    const expand = expandProp ?? globalExpand;
    const handleExpandChange = onExpandChange ?? ((next: boolean) => globalToggle(next));

    const [width, setWidth] = useState<string | number>(defaultWidth);

    return (
      <DraggablePanel
        backgroundColor={cssVar.colorBgContainer}
        expand={expand}
        expandable={false}
        maxWidth={maxWidth}
        minWidth={minWidth}
        placement="right"
        size={{
          height: '100%',
          width,
        }}
        onExpandChange={handleExpandChange}
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
