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

import { getMarqueeDuration, shouldRevealOnPointerDown } from './utils';

const scrollToHead = stylex.keyframes({
  '0%, 20%': { transform: 'translateX(0)' },
  '40%, 60%': { transform: 'translateX(var(--tail-marquee-offset))' },
  '80%, 100%': { transform: 'translateX(0)' },
});

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
  overflowing: {
    maskImage: {
      'default': 'linear-gradient(to right, transparent, #000 16px)',
      ':is(:focus-visible > *, :focus-visible > * > *)': 'none',
      ':is([data-revealing])': 'none',
      '@media (hover: hover)': { 'default': null, ':hover': 'none' },
    },
  },
  animated: {
    animationName: {
      'default': null,
      ':is(:focus-visible > * > span, :focus-visible > * > * > span)': scrollToHead,
      ':is([data-revealing] > span)': scrollToHead,
      '@media (hover: hover)': {
        'default': null,
        ':is(:hover > span)': scrollToHead,
        '@media (prefers-reduced-motion: reduce)': {
          'default': 'none',
          ':is(:focus-visible > * > span, :focus-visible > * > * > span)': 'none',
          ':is([data-revealing] > span)': 'none',
          ':is(:hover > span)': 'none',
        },
      },
      '@media (prefers-reduced-motion: reduce)': {
        'default': 'none',
        ':is(:focus-visible > * > span, :focus-visible > * > * > span)': 'none',
        ':is([data-revealing] > span)': 'none',
        ':is(:hover > span)': 'none',
      },
    },
    animationDuration: {
      'default': null,
      ':is(:focus-visible > * > span, :focus-visible > * > * > span)':
        'var(--tail-marquee-duration)',
      ':is([data-revealing] > span)': 'var(--tail-marquee-duration)',
      '@media (hover: hover)': {
        'default': null,
        ':is(:hover > span)': 'var(--tail-marquee-duration)',
        '@media (prefers-reduced-motion: reduce)': {
          'default': '0s',
          ':is(:focus-visible > * > span, :focus-visible > * > * > span)': '0s',
          ':is([data-revealing] > span)': '0s',
          ':is(:hover > span)': '0s',
        },
      },
      '@media (prefers-reduced-motion: reduce)': {
        'default': '0s',
        ':is(:focus-visible > * > span, :focus-visible > * > * > span)': '0s',
        ':is([data-revealing] > span)': '0s',
        ':is(:hover > span)': '0s',
      },
    },
    animationTimingFunction: {
      'default': null,
      ':is(:focus-visible > * > span, :focus-visible > * > * > span)': 'ease-in-out',
      ':is([data-revealing] > span)': 'ease-in-out',
      '@media (hover: hover)': {
        'default': null,
        ':is(:hover > span)': 'ease-in-out',
        '@media (prefers-reduced-motion: reduce)': {
          'default': 'ease',
          ':is(:focus-visible > * > span, :focus-visible > * > * > span)': 'ease',
          ':is([data-revealing] > span)': 'ease',
          ':is(:hover > span)': 'ease',
        },
      },
      '@media (prefers-reduced-motion: reduce)': {
        'default': 'ease',
        ':is(:focus-visible > * > span, :focus-visible > * > * > span)': 'ease',
        ':is([data-revealing] > span)': 'ease',
        ':is(:hover > span)': 'ease',
      },
    },
    animationIterationCount: {
      'default': null,
      ':is(:focus-visible > * > span, :focus-visible > * > * > span)': 'infinite',
      ':is([data-revealing] > span)': 1,
      '@media (hover: hover)': {
        'default': null,
        ':is(:hover > span)': 'infinite',
        '@media (prefers-reduced-motion: reduce)': {
          'default': 1,
          ':is(:focus-visible > * > span, :focus-visible > * > * > span)': 1,
          ':is([data-revealing] > span)': 1,
          ':is(:hover > span)': 1,
        },
      },
      '@media (prefers-reduced-motion: reduce)': {
        'default': 1,
        ':is(:focus-visible > * > span, :focus-visible > * > * > span)': 1,
        ':is([data-revealing] > span)': 1,
        ':is(:hover > span)': 1,
      },
    },
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
      {...sx([styles.container, overflow > 0 && styles.overflowing], className, {
        ...style,
        '--tail-marquee-duration': `${duration}s`,
        '--tail-marquee-offset': `${overflow}px`,
      } as CSSProperties)}
      onAnimationEnd={() => setRevealing(false)}
      onPointerDown={handlePointerDown}
    >
      <span ref={contentRef} {...stylex.props(styles.content, overflow > 0 && styles.animated)}>
        {children}
      </span>
    </div>
  );
};

export default TailMarquee;
