'use client';

import type { WidgetLayoutNode, WidgetLayoutValue, WidgetOutput } from '@lobechat/types';
import { cssVar } from '@lobehub/ui';
import { memo } from 'react';

import LayoutNode from './LayoutNode';
import { createLayoutScope, resolveSurface } from './resolve';
import { WIDGET_SURFACE_STYLES } from './surfaces';

interface LayoutViewProps {
  /**
   * Draw the layout in its own card-sized frame with its surface, for hosts
   * that show the output without a widget card around it (drill-down, run
   * preview). A widget card paints the surface itself.
   */
  framed?: boolean;
  layout: WidgetLayoutNode;
  output: WidgetOutput;
  surface?: WidgetLayoutValue;
}

/** A widget output drawn by its version's declarative layout. */
const LayoutView = memo<LayoutViewProps>(({ layout, output, framed, surface }) => {
  const scope = createLayoutScope(output);
  const content = (
    <div data-widget-layout style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <LayoutNode node={{ flex: 1, ...layout } as WidgetLayoutNode} scope={scope} />
    </div>
  );
  if (!framed) return content;

  return (
    <div
      data-widget-layout-frame
      style={{
        border: `1px solid ${cssVar.colorBorderSecondary}`,
        borderRadius: cssVar.borderRadiusLG,
        containerType: 'size',
        height: 300,
        maxWidth: 420,
        overflow: 'hidden',
        padding: 16,
        ...WIDGET_SURFACE_STYLES[resolveSurface(surface, scope)],
      }}
    >
      {content}
    </div>
  );
});

LayoutView.displayName = 'DashboardWidgetLayoutView';

export default LayoutView;

export { createLayoutScope, resolveSurface } from './resolve';
export { WIDGET_SURFACE_STYLES } from './surfaces';
