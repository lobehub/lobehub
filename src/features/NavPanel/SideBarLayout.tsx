import { Flexbox, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo, Suspense } from 'react';

import Footer from '@/app/[variants]/(main)/home/_layout/Footer';
import SkeletonList, { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';

interface SidebarLayoutProps {
  body?: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
}

const SideBarLayout = memo<SidebarLayoutProps>(({ header, body, footer }) => {
  return (
    <Flexbox gap={4} style={{ height: '100%', overflow: 'hidden' }}>
      <Suspense fallback={<SkeletonItem height={44} style={{ marginTop: 8 }} />}>{header}</Suspense>
      <ScrollShadow size={2} style={{ height: '100%' }}>
        <TooltipGroup>
          <Suspense fallback={<SkeletonList paddingBlock={8} />}>{body}</Suspense>
        </TooltipGroup>
      </ScrollShadow>
      <Suspense>{footer || <Footer />}</Suspense>
    </Flexbox>
  );
});

export default SideBarLayout;
