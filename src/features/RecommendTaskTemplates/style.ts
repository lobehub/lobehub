import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

// `card` and `compactRow` carry `stylex.defaultMarker()`; the dismiss button
// reveals itself from their hover (and, in the compact row, focus-within) state.
export const styles = stylex.create({
  // `!important` dropped: lobe-ui's Block CSS sits in `@layer lobe-ui`.
  card: {
    borderColor: { 'default': null, ':hover': cssVar.colorBorder },
  },
  compactRow: {
    marginInline: '-8px',
    paddingInlineEnd: '4px',
    borderRadius: cssVar.borderRadius,
    transition: `background ${cssVar.motionDurationFast}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  // compactRow owns the hover highlight; the selector mirrors base-ui's
  // variantText hover rule so it can outrank its fill
  compactMain: {
    flex: '1',
    justifyContent: 'flex-start',
    height: 'auto',
    paddingBlock: '6px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '4px',
    borderWidth: 0,
    borderStyle: 'none',
    textAlign: 'start',
    backgroundColor: {
      'default': null,
      ':hover:not(:disabled, [aria-disabled="true"])': 'transparent',
    },
    backgroundImage: {
      'default': null,
      ':hover:not(:disabled, [aria-disabled="true"])': 'none',
    },
  },
  compactTitle: {
    minWidth: '0',
  },
  dismissBtn: {
    pointerEvents: { default: 'none', [stylex.when.ancestor(':hover')]: 'auto' },
    flexShrink: 0,
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    transition: 'opacity 0.15s',
  },
  dismissBtnCompact: {
    pointerEvents: {
      default: 'none',
      [stylex.when.ancestor(':hover')]: 'auto',
      [stylex.when.ancestor(':focus-within')]: 'auto',
    },
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
    },
  },
});
