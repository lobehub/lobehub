import { DraggablePanel, type DraggablePanelProps, Drawer } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui';
import { memo, Suspense, useState } from 'react';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isMobileSurface } from '@/utils/mobileSurface';

import { useMobilePanelExpand } from './useMobilePanelExpand';

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
  /**
   * `expand` mirrors a selection made on this page (e.g. the picked record), not
   * a saved open/closed preference. Mobile closes a panel that mounts open,
   * since a saved desktop preference would otherwise cover the phone page; a
   * fresh selection must stay open.
   */
  expandFollowsSelection?: boolean;
  onExpandChange?: (expand: boolean) => void;
  onSizeChange?: (size?: Size) => void;
  /**
   * Controlled width. When provided, the parent owns the width (and should keep
   * it in sync via `onSizeChange` on drag). Omit for the default self-managed
   * behaviour seeded by `defaultWidth`.
   */
  width?: number | string;
}

const RightPanel = memo<RightPanelProps>(
  ({
    maxWidth = 600,
    minWidth = 300,
    children,
    defaultWidth = 360,
    expand: expandProp,
    expandFollowsSelection,
    onExpandChange,
    onSizeChange,
    width: widthProp,
    ...rest
  }) => {
    const [globalExpand, globalToggle] = useGlobalStore((s) => [
      systemStatusSelectors.showRightPanel(s),
      s.toggleRightPanel,
    ]);

    const expand = expandProp ?? globalExpand;
    const handleExpandChange = onExpandChange ?? ((next: boolean) => globalToggle(next));

    const [internalWidth, setInternalWidth] = useState<string | number>(defaultWidth);
    const width = widthProp ?? internalWidth;
    const mobile = isMobileSurface();

    useMobilePanelExpand({
      expand: !!expand,
      expandFollowsSelection,
      mobile,
      onExpandChange: handleExpandChange,
    });

    if (mobile)
      return (
        <Drawer
          open={expand}
          placement={'right'}
          styles={{ bodyContent: { padding: 0 } }}
          width={'100%'}
          onClose={() => handleExpandChange(false)}
        >
          <Suspense fallback={<SurfaceSkeleton header={false} variant={'list'} />}>
            {children}
          </Suspense>
        </Drawer>
      );

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
            setInternalWidth(size.width);
          }
          if (size) onSizeChange?.(size);
        }}
        {...rest}
      >
        <Suspense fallback={<SurfaceSkeleton header={false} variant={'list'} />}>
          {children}
        </Suspense>
      </DraggablePanel>
    );
  },
);

export default RightPanel;
