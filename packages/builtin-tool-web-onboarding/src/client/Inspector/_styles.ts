import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const inspectorChipStyles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '4px',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '240px',
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
  emoji: {
    flexShrink: 0,
    fontSize: '14px',
    lineHeight: 1,
  },
  meta: {
    flexShrink: 0,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  separator: {
    flexShrink: 0,
    marginInline: '4px',
    color: cssVar.colorTextQuaternary,
  },
});
