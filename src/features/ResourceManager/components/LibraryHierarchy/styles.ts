import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  dragging: {
    willChange: 'transform',
    opacity: 0.5,
  },
  nodeActions: {
    opacity: {
      'default': 0,
      ':focus-within': 1,
      ':is([data-open="true"])': 1,
      [stylex.when.ancestor(':hover')]: 1,
    },
    transition: 'opacity 0.15s',
  },
  fileItemDragOver: {
    outlineWidth: '1px',
    outlineStyle: 'dashed',
    outlineColor: cssVar.colorPrimaryBorder,
    outlineOffset: '-2px',
    backgroundColor: { 'default': cssVar.colorPrimaryBg, ':hover': cssVar.colorPrimaryBg },
    backgroundImage: 'none',
  },
  treeItem: {
    cursor: 'pointer',
  },
});
