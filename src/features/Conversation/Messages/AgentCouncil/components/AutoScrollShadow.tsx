import { ScrollArea } from '@lobehub/ui';
import type { PropsWithChildren, RefObject } from 'react';
import { memo, useEffect } from 'react';

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
    <ScrollArea
      scrollFade
      style={{ background: 'transparent', borderRadius: 0 }}
      contentProps={{
        style: {
          color: 'inherit',
          display: 'block',
          fontSize: 'inherit',
          gap: 0,
          lineHeight: 'inherit',
        },
      }}
      viewportProps={{
        ref: ref as RefObject<HTMLDivElement>,
        style: { height: 'max(33vh, 480px)' },
        onScroll: handleScroll,
      }}
    >
      {children}
    </ScrollArea>
  );
});

export default AutoScrollShadow;
