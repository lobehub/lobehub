import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

const refreshSpin = stylex.keyframes({
  to: { transform: 'rotate(360deg)' },
});

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

// The row/card hover rules mirror base-ui's variantText hover selector so the
// tint can outrank its brighter fill.
export const styles = stylex.create({
  // `!important` dropped: lobe-ui's Block CSS sits in `@layer lobe-ui`.
  card: {
    borderColor: { 'default': null, ':hover': cssVar.colorBorder },
  },
  compactRow: {
    justifyContent: 'flex-start',
    width: 'calc(100% + 16px)',
    height: 'auto',
    marginInline: '-8px',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: cssVar.borderRadius,
    textAlign: 'start',
    transition: `background ${cssVar.motionDurationFast}`,
    backgroundColor: {
      'default': null,
      ':hover:not(:disabled, [aria-disabled="true"])': cssVar.colorFillQuaternary,
    },
    backgroundImage: {
      'default': null,
      ':hover:not(:disabled, [aria-disabled="true"])': 'none',
    },
  },
  compactTitle: {
    minWidth: '0',
  },
  // The duration is `SPIN_TURN_MS` (./spinHold): StyleX cannot read an imported
  // constant, so keep the two in step. Reduced motion keeps the "working" signal
  // and drops the rotation.
  refreshSpin: {
    animationName: { default: refreshSpin, [REDUCED_MOTION]: 'none' },
    animationDuration: '600ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    opacity: { default: null, [REDUCED_MOTION]: 0.45 },
  },
  subtitle: {
    color: cssVar.colorTextDescription,
  },
});
