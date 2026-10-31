import { HtmlPreviewIframe } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { nextWidenBaseline } from './widenRemount';

const styles = stylex.create({
  container: { width: '100%' },
  frame: { display: 'block', width: '100%', borderStyle: 'none' },
});

interface HtmlDocumentFrameProps {
  content: string;
  title?: string;
}

/**
 * The body of an HTML page document. The page is model- or user-authored, so
 * it runs in the preview's default sandbox (scripts, no same origin) and grows
 * to its own height inside the surrounding scroll container. Its auto-height
 * cannot shrink, so the frame is remounted when the container widens (e.g. a
 * page opened from the narrow chat portal).
 */
const HtmlDocumentFrame = ({ content, title }: HtmlDocumentFrameProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    let baseline = node.clientWidth;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      const next = nextWidenBaseline(baseline, node.clientWidth);
      baseline = next.baseline;
      if (!next.remount) return;
      // Wait for a layout transition to settle before measuring again.
      clearTimeout(timer);
      timer = setTimeout(() => setFrameKey((key) => key + 1), 150);
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div {...stylex.props(styles.container)} ref={containerRef}>
      <HtmlPreviewIframe
        className={stylex.props(styles.frame).className}
        content={content}
        defaultHeight={480}
        key={frameKey}
        title={title || undefined}
      />
    </div>
  );
};

/**  Superseded by Canvas (`lobe-canvas`); kept so existing conversations keep rendering. */
export default HtmlDocumentFrame;
