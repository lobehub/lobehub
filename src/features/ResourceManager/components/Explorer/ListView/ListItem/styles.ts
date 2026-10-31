import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  hover: {
    opacity: {
      'default': 0,
      ':is([data-popup-open], .file-list-item-group:hover *)': 1,
    },
  },
  name: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    marginInlineStart: '12px',
    color: cssVar.colorText,
    whiteSpace: 'nowrap',
  },
  nameContainer: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
  },
});
