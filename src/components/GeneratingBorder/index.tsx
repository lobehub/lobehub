'use client';

import './property.css';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import { sx } from '@/styles/sx';

import moduleStyles from './GeneratingBorder.module.css';

const styles = stylex.create({
  shell: { position: 'relative', borderRadius: '8px' },
  // `overflow: hidden` belongs to the generating state only: on the resting
  // shell it clips the wrapped input's own focus glow while the user types.
  shellGenerating: {
    'overflow': 'hidden',
    '::after': {
      pointerEvents: 'none',
      content: '""',
      position: 'absolute',
      zIndex: 1,
      inset: 0,
      padding: '2px',
      borderRadius: 'inherit',
      backgroundImage: `conic-gradient(
        from var(--lobe-generating-border-angle),
        ${cssVar.colorBorderSecondary} 0deg 210deg,
        #ff3d8d 238deg,
        #8b5cf6 258deg,
        #00c8ff 278deg,
        #22e6a8 298deg,
        #ffd43b 318deg,
        #ff6b35 338deg,
        ${cssVar.colorBorderSecondary} 360deg
      )`,
      // Masks the gradient down to the 2px padding ring, so only the edge lights up.
      mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
      maskComposite: 'exclude',
    },
  },
});

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
    <Flexbox
      {...sx(
        [styles.shell, generating && styles.shellGenerating],
        [generating && moduleStyles.generating, className].filter(Boolean).join(' '),
        style,
      )}
    >
      {children}
    </Flexbox>
  ),
);

export default GeneratingBorder;
