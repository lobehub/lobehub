import { ScrollShadow } from '@lobehub/ui';
import { type PropsWithChildren, type RefObject, memo, useEffect, useRef } from 'react';

const AutoScrollShadow = memo<PropsWithChildren>(({ children }) => {
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceToBottom < 120;

    if (isNearBottom) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, []);

  return (
    <ScrollShadow
      height={'max(33vh, 480px)'}
      hideScrollBar
      ref={contentRef as unknown as RefObject<HTMLDivElement>}
      size={16}
    >
      {children}
    </ScrollShadow>
  );
});

export default AutoScrollShadow;
