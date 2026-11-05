import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { groupBlockActionMarker } from './markers.stylex';

export const groupBlockActionStyles = stylex.create({
  button: {
    color: {
      default: null,
      [stylex.when.ancestor(':is(*)', groupBlockActionMarker)]: cssVar.colorTextSecondary,
    },
  },
});
