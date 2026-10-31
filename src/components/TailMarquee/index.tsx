import * as stylex from '@stylexjs/stylex';
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { sx } from '@/styles/sx';

import moduleStyles from './TailMarquee.module.css';
import { getMarqueeDuration, shouldRevealOnPointerDown } from './utils';

const styles = stylex.create({
  container: {
    // Paths read left to right in every locale; the alignment, fade and
    // translate below all assume LTR, so pin it even inside an RTL page.
    direction: 'ltr',
    unicodeBidi: 'isolate',
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    justifyContent: 'flex-end',
    minWidth: 0,
  },
  content: {
    flex: 'none',
    whiteSpace: 'nowrap',
  },
});

interface TailMarqueeProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Single-line text that keeps its tail visible when it overflows (paths read
 * from the end), and scrolls back to the head on hover, on keyboard focus of
 * the enclosing control, or once per tap on touch screens. The full text is
 * also exposed as a native tooltip.
 */
const TailMarquee = ({ children, className, style }: TailMarqueeProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  const [fullText, setFullText] = useState<string>();
  const [revealing, setRevealing] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const measure = () => {
      setOverflow(Math.max(0, content.offsetWidth - container.clientWidth));
      setFullText(content.textContent ?? undefined);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const handlePointerDown = (event: PointerEvent) => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (shouldRevealOnPointerDown({ overflow, pointerType: event.pointerType, reducedMotion }))
      setRevealing(true);
  };

  const duration = getMarqueeDuration(overflow);

  return (
    <div
      data-revealing={revealing || undefined}
      ref={containerRef}
      title={overflow > 0 ? fullText : undefined}
      {...sx(
        [styles.container],
        [overflow > 0 && moduleStyles.overflowing, className].filter(Boolean).join(' '),
        {
          ...style,
          '--tail-marquee-duration': `${duration}s`,
          '--tail-marquee-offset': `${overflow}px`,
        } as CSSProperties,
      )}
      onAnimationEnd={() => setRevealing(false)}
      onPointerDown={handlePointerDown}
    >
      <span ref={contentRef} {...stylex.props(styles.content)}>
        {children}
      </span>
    </div>
  );
};

export default TailMarquee;
