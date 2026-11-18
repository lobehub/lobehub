import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { chatItemMarker } from './markers.stylex';

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
  time: {
    pointerEvents: { default: 'none', [stylex.when.ancestor(':hover', chatItemMarker)]: 'unset' },
    display: 'inline-block',
    whiteSpace: 'nowrap',
    opacity: { default: 0, [stylex.when.ancestor(':hover', chatItemMarker)]: 1 },
    transition: `opacity 200ms ${cssVar.motionEaseOut}`,
  },
});
