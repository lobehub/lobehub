import { ScrollShadow } from '@lobehub/ui';
import { type PropsWithChildren, type RefObject, memo, useEffect } from 'react';

import { useAutoScroll } from '@/hooks/useAutoScroll';

interface AutoScrollShadowProps extends PropsWithChildren {
  /**
   * Content string to track for auto-scrolling
   */
  content?: string;
  /**
   * Whether the content is currently streaming/generating
   */
  streaming?: boolean;
}

const AutoScrollShadow = memo<AutoScrollShadowProps>(({ children, content, streaming }) => {
  const { ref, handleScroll, resetScrollLock } = useAutoScroll<HTMLDivElement>({
    deps: [content],
    enabled: streaming,
  });

  // Reset scroll lock when content is cleared (new stream starts)
  useEffect(() => {
    if (!content) {
      resetScrollLock();
    }
  }, [content, resetScrollLock]);

  return (
    <ScrollShadow
      height={'max(33vh, 480px)'}
      hideScrollBar
      onScroll={handleScroll}
      ref={ref as RefObject<HTMLDivElement>}
      size={16}
    >
      {children}
    </ScrollShadow>
  );
});

export default AutoScrollShadow;
