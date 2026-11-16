import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const gateStyles = stylex.create({
  code: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  label: {
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  meta: {
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
  },
  note: {
    margin: 0,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
});
