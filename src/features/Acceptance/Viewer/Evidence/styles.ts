import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  caption: {
    alignSelf: 'center',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  evidenceImage: {
    overflow: 'hidden',
    width: 'fit-content',
    maxWidth: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  evidenceText: {
    overflow: 'auto',
    maxHeight: '200px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
  },
});
