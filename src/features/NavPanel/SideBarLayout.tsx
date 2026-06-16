import { Flexbox, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo, Suspense } from 'react';

import SkeletonList, { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';

interface SidebarLayoutProps {
  body?: ReactNode;
  /** Optional pinned area below the scrollable body (e.g. a primary action). */
  footer?: ReactNode;
  header?: ReactNode;
}

const SideBarLayout = memo<SidebarLayoutProps>(({ header, body, footer }) => {
  return (
    <Flexbox gap={1} style={{ height: '100%', overflow: 'hidden' }}>
      <Suspense fallback={<SkeletonItem height={44} style={{ marginTop: 8 }} />}>{header}</Suspense>
      <ScrollShadow size={2} style={{ height: '100%' }}>
        <TooltipGroup>
          <Suspense fallback={<SkeletonList paddingBlock={8} />}>{body}</Suspense>
        </TooltipGroup>
      </ScrollShadow>
      {footer}
    </Flexbox>
  );
});

export default SideBarLayout;
