import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const cardStyles = stylex.create({
  arrow: { flex: 'none', color: cssVar.colorTextQuaternary },
  card: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  label: { flex: 'none', minWidth: '40px', color: cssVar.colorTextDescription },
  row: {
    paddingBlock: '4px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  status: { flex: 'none', fontSize: '12px' },
});
