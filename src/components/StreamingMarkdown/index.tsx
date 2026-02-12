'use client';

import { Markdown, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type RefObject } from 'react';
import { memo, useEffect } from 'react';

import { useAutoScroll } from '@/hooks/useAutoScroll';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-radius: 8px;
    font-size: 14px;
  `,
}));

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
    <ScrollShadow
      className={styles.container}
      offset={12}
      ref={ref as RefObject<HTMLDivElement>}
      size={12}
      style={{ maxHeight }}
      onScroll={handleScroll}
    >
      <Markdown animated style={{ overflow: 'unset' }} variant={'chat'}>
        {children}
      </Markdown>
    </ScrollShadow>
  );
});

StreamingMarkdown.displayName = 'StreamingMarkdown';

export default StreamingMarkdown;
