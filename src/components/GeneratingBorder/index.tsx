'use client';

import { Flexbox } from '@lobehub/ui';
import { createGlobalStyle, createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';

/**
 * `@property` is what makes the angle animatable — a plain custom property is
 * an unregistered token and jumps from 0deg to 360deg instead of sweeping.
 * Declared once here rather than per call site.
 */
const BorderAngleProperty = createGlobalStyle`
  @property --lobe-generating-border-angle {
    inherits: false;
    initial-value: 0deg;
    syntax: '<angle>';
  }
`;

const styles = createStaticStyles(({ css }) => ({
  shell: css`
    position: relative;
    border-radius: 8px;
  `,
  // `overflow: hidden` belongs to the generating state only: on the resting
  // shell it clips the wrapped input's own focus glow while the user types.
  shellGenerating: css`
    overflow: hidden;

    &::after {
      pointer-events: none;
      content: '';

      position: absolute;
      z-index: 1;
      inset: 0;

      padding: 2px;
      border-radius: inherit;

      background: conic-gradient(
        from var(--lobe-generating-border-angle),
        ${cssVar.colorBorderSecondary} 0deg 210deg,
        #ff3d8d 238deg,
        #8b5cf6 258deg,
        #00c8ff 278deg,
        #22e6a8 298deg,
        #ffd43b 318deg,
        #ff6b35 338deg,
        ${cssVar.colorBorderSecondary} 360deg
      );

      /* Masks the gradient down to the 2px padding ring, so only the edge lights up. */
      mask:
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);

      animation: lobe-generating-border-flow 1.8s linear infinite;

      mask-composite: exclude;
    }

    @keyframes lobe-generating-border-flow {
      from {
        --lobe-generating-border-angle: 0deg;
      }

      to {
        --lobe-generating-border-angle: 360deg;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      &::after {
        animation: none;
      }
    }
  `,
}));

export interface GeneratingBorderProps {
  children?: ReactNode;
  className?: string;
  /** Lights the ring. Resting state renders the children untouched. */
  generating?: boolean;
  style?: React.CSSProperties;
}

/**
 * The flowing rainbow ring that marks "a model is writing this for you".
 *
 * It reads as one product gesture, so it is one component: every surface that
 * hands an input over to a generation — drafting a goal's acceptance contract,
 * naming a self-learning domain, reading a task draft — lights the same ring at
 * the same speed. Written per call site it drifts, and each copy also has to
 * remember the `@property` registration that makes the sweep animate at all.
 */
const GeneratingBorder = memo<GeneratingBorderProps>(
  ({ children, className, generating, style }) => (
    <>
      <BorderAngleProperty />
      <Flexbox
        style={style}
        className={[styles.shell, generating && styles.shellGenerating, className]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </Flexbox>
    </>
  ),
);

export default GeneratingBorder;
