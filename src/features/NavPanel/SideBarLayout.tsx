import { Flexbox, TooltipGroup } from '@lobehub/ui';
import { ScrollArea } from '@lobehub/ui/base-ui';
import { type ReactNode, type UIEvent } from 'react';
import { memo, Suspense, useCallback, useLayoutEffect, useRef } from 'react';

import { SideBarHeaderSkeleton } from '@/features/NavPanel/components/SideBarSkeleton';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';

import { useActiveNavKey } from './useActiveNavKey';

const scrollOffsets = new Map<string, number>();

interface SidebarLayoutProps {
  body?: ReactNode;
  header?: ReactNode;
}

const SideBarLayout = memo<SidebarLayoutProps>(({ header, body }) => {
  const navKey = useActiveNavKey();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      scrollOffsets.set(navKey, e.currentTarget.scrollTop);
    },
    [navKey],
  );

  // Runs on mount and on Activity reveal; display:none drops the browser's own offset.
  useLayoutEffect(() => {
    const offset = scrollOffsets.get(navKey);
    if (offset && scrollerRef.current) scrollerRef.current.scrollTop = offset;
  }, [navKey]);

  return (
    <Flexbox gap={1} style={{ height: '100%', overflow: 'hidden' }}>
      <Suspense fallback={<SideBarHeaderSkeleton />}>{header}</Suspense>
      <ScrollArea
        disableContentFit
        scrollFade
        // Preserve the height chain for sidebar bodies containing virtual lists.
        contentProps={{ style: { height: '100%' } }}
        style={{ flex: 1, minHeight: 0 }}
        viewportProps={{ onScroll: handleScroll, ref: scrollerRef }}
      >
        <TooltipGroup>
          <Suspense fallback={<SkeletonList paddingBlock={8} />}>{body}</Suspense>
        </TooltipGroup>
      </ScrollArea>
    </Flexbox>
  );
});

export default SideBarLayout;
