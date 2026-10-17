import { createStaticStyles, cx, keyframes } from '@lobehub/ui';
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { getMarqueeDuration, HOLD_RATIO, shouldRevealOnPointerDown } from './utils';

const HOLD = HOLD_RATIO * 100;

// Hold at the tail, scroll to the head, hold, scroll back.
const scrollToHead = keyframes`
  0%,
  ${HOLD}% {
    transform: translateX(0);
  }

  ${50 - HOLD / 2}%,
  ${50 + HOLD / 2}% {
    transform: translateX(var(--tail-marquee-offset));
  }

  ${100 - HOLD}%,
  100% {
    transform: translateX(0);
  }
`;

const styles = createStaticStyles(({ css }) => ({
  container: css`
    /* Paths read left to right in every locale; the alignment, fade and
       translate below all assume LTR, so pin it even inside an RTL page. */
    direction: ltr;
    unicode-bidi: isolate;
    overflow: hidden;
    display: flex;
    flex: 1;
    justify-content: flex-end;

    min-width: 0;
  `,
  overflowing: css`
    mask-image: linear-gradient(to right, transparent, #000 16px);

    /* Keyboard focus on the enclosing control (e.g. an accordion trigger)
       loops; a tap on a touch screen plays one loop. */
    *:focus-visible > &,
    *:focus-visible > * > &,
    &[data-revealing] {
      mask-image: none;
    }

    *:focus-visible > & > span,
    *:focus-visible > * > & > span {
      animation: ${scrollToHead} var(--tail-marquee-duration) ease-in-out infinite;
    }

    &[data-revealing] > span {
      animation: ${scrollToHead} var(--tail-marquee-duration) ease-in-out 1;
    }

    /* Only real hover loops: touch browsers keep a sticky :hover after a tap,
       which would otherwise turn the one-loop tap reveal into an endless one. */
    @media (hover: hover) {
      &:hover {
        mask-image: none;
      }

      &:hover > span {
        animation: ${scrollToHead} var(--tail-marquee-duration) ease-in-out infinite;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      & > span {
        animation: none !important;
      }
    }
  `,
  content: css`
    flex: none;
    white-space: nowrap;
  `,
}));

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
      className={cx(styles.container, overflow > 0 && styles.overflowing, className)}
      data-revealing={revealing || undefined}
      ref={containerRef}
      title={overflow > 0 ? fullText : undefined}
      style={
        {
          ...style,
          '--tail-marquee-duration': `${duration}s`,
          '--tail-marquee-offset': `${overflow}px`,
        } as CSSProperties
      }
      onAnimationEnd={() => setRevealing(false)}
      onPointerDown={handlePointerDown}
    >
      <span className={styles.content} ref={contentRef}>
        {children}
      </span>
    </div>
  );
};

export default TailMarquee;
