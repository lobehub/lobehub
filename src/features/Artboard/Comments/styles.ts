import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const cardStyles = stylex.create({
  card: {
    color: cssVar.colorText,
    cursor: 'default',
    fontSize: 12,
    lineHeight: 1.6,
  },
  head: {
    alignItems: 'center',
    display: 'flex',
    fontSize: 11,
    gap: 8,
    paddingBlockStart: 10,
    paddingInline: 14,
  },
  label: {
    color: cssVar.colorTextTertiary,
    flex: '1',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});
