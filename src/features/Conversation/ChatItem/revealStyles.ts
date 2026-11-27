import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { chatItemMarker } from './markers.stylex';

const HAS_ACTION_GROUP = ':has(.lobe-action-icon-group)';

export const revealStyles = stylex.create({
  menubar: {
    pointerEvents: {
      default: 'none',
      [stylex.when.ancestor(':hover', chatItemMarker)]: 'unset',
      [stylex.when.ancestor(':has([data-popup-open])', chatItemMarker)]: 'unset',
    },
    display: 'flex',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', chatItemMarker)]: 1,
      [stylex.when.ancestor(':has([data-popup-open])', chatItemMarker)]: 1,
    },
    transition: `opacity 200ms ${cssVar.motionEaseOut}`,
  },
  floatingToolbar: {
    position: 'absolute',
    insetBlockStart: 6,
    zIndex: 1,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { default: null, [HAS_ACTION_GROUP]: cssVar.colorBgElevated },
    boxShadow: { default: null, [HAS_ACTION_GROUP]: cssVar.boxShadowTertiary },
    pointerEvents: {
      default: 'none',
      [stylex.when.ancestor(':hover', chatItemMarker)]: 'unset',
      [stylex.when.ancestor(':focus-within', chatItemMarker)]: 'unset',
      [stylex.when.ancestor(':has([data-popup-open])', chatItemMarker)]: 'unset',
    },
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', chatItemMarker)]: 1,
      [stylex.when.ancestor(':focus-within', chatItemMarker)]: 1,
      [stylex.when.ancestor(':has([data-popup-open])', chatItemMarker)]: 1,
    },
    transition: `opacity 200ms ${cssVar.motionEaseOut}`,
  },
  floatingToolbarEnd: {
    insetInlineEnd: 0,
  },
  floatingToolbarLeading: {
    paddingInlineStart: 8,
  },
  floatingToolbarStart: {
    insetInlineStart: 0,
  },
  time: {
    pointerEvents: { default: 'none', [stylex.when.ancestor(':hover', chatItemMarker)]: 'unset' },
    display: 'inline-block',
    whiteSpace: 'nowrap',
    opacity: { default: 0, [stylex.when.ancestor(':hover', chatItemMarker)]: 1 },
    transition: `opacity 200ms ${cssVar.motionEaseOut}`,
  },
});
