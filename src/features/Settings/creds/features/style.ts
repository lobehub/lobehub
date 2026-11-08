import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  container: {
    paddingBlock: '12px',
    paddingInline: 0,
  },
  description: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  icon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  key: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  title: {
    fontSize: '15px',
    fontWeight: 500,
    color: cssVar.colorText,
  },
});
