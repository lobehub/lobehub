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
    cursor: 'pointer',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    width: '100%',
    paddingBlockStart: '12px',
    paddingBlockEnd: '4px',
    paddingInline: '6px',
    borderWidth: 0,
    fontFamily: 'inherit',
    fontSize: '12px',
    color: { default: cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    textAlign: 'start',
    backgroundColor: 'transparent',
  },
});
