import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  code: {
    fontFamily: cssVar.fontFamilyCode,
  },
  desc: {
    overflow: 'hidden',
    margin: 0,
    fontSize: '13px',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: {
    padding: '18px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    fontSize: '13px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  meta: {
    flex: 'none',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
  name: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '20px',
  },
  sectionDesc: {
    margin: 0,
    fontSize: '13px',
    color: cssVar.colorTextTertiary,
  },
  subtitle: {
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
  },
  sectionTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    lineHeight: 1.5,
    whiteSpace: 'nowrap',
  },
});
