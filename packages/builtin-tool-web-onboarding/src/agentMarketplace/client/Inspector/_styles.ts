import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const inspectorChipStyles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '200px',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  meta: {
    flexShrink: 0,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
});
