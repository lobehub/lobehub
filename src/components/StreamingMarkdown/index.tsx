'use client';

import { Markdown, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const isAutoScrollingRef = useRef(false);

  // Handle user scroll detection
  const handleScroll = useCallback(() => {
    // Ignore scroll events triggered by auto-scroll
    if (isAutoScrollingRef.current) return;

    const container = containerRef.current;
    if (!container) return;

    // Check if user scrolled away from bottom
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceToBottom < 20;

    // If user scrolled up, stop auto-scrolling
    if (!isAtBottom) {
      setUserHasScrolled(true);
    }
  }, []);

  // Auto scroll to bottom when content changes (unless user has scrolled)
  useEffect(() => {
    if (userHasScrolled) return;

    const container = containerRef.current;
    if (!container) return;

    isAutoScrollingRef.current = true;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      // Reset the flag after scroll completes
      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false;
      });
    });
  }, [children, userHasScrolled]);

  // Reset userHasScrolled when content is cleared (new stream starts)
  useEffect(() => {
    if (!children) {
      setUserHasScrolled(false);
    }
  }, [children]);

  if (!children) return null;

  return (
    <ScrollShadow
      className={styles.container}
      offset={12}
      onScroll={handleScroll}
      ref={containerRef}
      size={12}
      style={{ maxHeight }}
    >
      <Markdown animated style={{ overflow: 'unset' }} variant={'chat'}>
        {children}
      </Markdown>
    </ScrollShadow>
  );
});

StreamingMarkdown.displayName = 'StreamingMarkdown';

export default StreamingMarkdown;
