import * as stylex from '@stylexjs/stylex';

import { messageSelectionMarker } from './markers.stylex';

export const selectionStyles = stylex.create({
  hidden: {
    display: { default: null, [stylex.when.ancestor(':is(*)', messageSelectionMarker)]: 'none' },
  },
});
