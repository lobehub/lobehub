import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

const styles = stylex.create({
  pane: {
    paddingBlockStart: sidebarRow.paneBlockStart,
    paddingBlockEnd: sidebarRow.paneBlockEnd,
    paddingInline: sidebarRow.paneInline,
  },
});

export const SidebarRowSkeleton = ({ rows = 3 }: { rows?: number }) => {
  const density = useDensityTokens();

  return (
    <Flexbox gap={1}>
      {Array.from({ length: rows }).map((_, index) => (
        <SkeletonItem
          avatarSize={density.iconSize}
          gap={density.gap}
          height={density.rowHeight}
          key={index}
          padding={'0 8px'}
        />
      ))}
    </Flexbox>
  );
};

/**
 * The right panel's placeholder for a tab that has not mounted yet.
 *
 * It waits one frame budget before appearing: the Files tab paints its
 * replica-backed tree within that window, and an immediately rendered
 * skeleton would flash over the saved tree even though it is ready.
 */
const DeferredSkeleton = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;
  return (
    <div {...stylex.props(styles.pane)}>
      <SidebarRowSkeleton rows={6} />
    </div>
  );
};

export default DeferredSkeleton;
