import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

// `treeItem` (the action-reveal descendant rules) lives in `hierarchy.module.css`.
export const styles = stylex.create({
  dragging: {
    willChange: 'transform',
    opacity: 0.5,
  },
  fileItemDragOver: {
    outlineWidth: '1px',
    outlineStyle: 'dashed',
    outlineColor: cssVar.colorPrimaryBorder,
    outlineOffset: '-2px',
    backgroundColor: { 'default': cssVar.colorPrimaryBg, ':hover': cssVar.colorPrimaryBg },
    backgroundImage: 'none',
  },
});
