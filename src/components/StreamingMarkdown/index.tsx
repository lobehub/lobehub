'use client';

import { Markdown, ScrollArea } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { RefObject } from 'react';
import { memo, useEffect } from 'react';

import { useAutoScroll } from '@/hooks/useAutoScroll';

const styles = stylex.create({
  container: { paddingBlock: '12px', paddingInline: '16px', borderRadius: '8px', fontSize: '14px' },
  scrollRoot: { borderRadius: '0', backgroundColor: 'transparent', backgroundImage: 'none' },
});

interface StreamingMarkdownProps {
  children?: string;
  maxHeight?: number;
}

const StreamingMarkdown = memo<StreamingMarkdownProps>(({ children, maxHeight = 400 }) => {
  const { ref, handleScroll, resetScrollLock } = useAutoScroll<HTMLDivElement>({
    deps: [children],
  });

  // Reset scroll lock when content is cleared (new stream starts)
  useEffect(() => {
    if (!children) {
      resetScrollLock();
    }
  }, [children, resetScrollLock]);

  if (!children) return null;

  return (
    <ScrollArea
      disableContentFit
      scrollFade
      className={stylex.props(styles.scrollRoot).className}
      viewportProps={{
        className: stylex.props(styles.container).className,
        ref: ref as RefObject<HTMLDivElement>,
        style: { maxHeight },
        onScroll: handleScroll,
      }}
    >
      <Markdown animated style={{ overflow: 'unset' }} variant={'chat'}>
        {children}
      </Markdown>
    </ScrollArea>
  );
});

StreamingMarkdown.displayName = 'StreamingMarkdown';

export default StreamingMarkdown;
