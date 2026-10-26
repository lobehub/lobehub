import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  count: {
    marginInlineStart: '6px',
    color: cssVar.colorTextQuaternary,
  },
  empty: {
    paddingBlock: '8px',
    paddingInline: '10px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
  sectionTitle: {
    paddingBlockStart: '12px',
    paddingBlockEnd: '4px',
    paddingInline: '10px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
});
