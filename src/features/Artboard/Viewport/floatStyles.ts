import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const floatStyles = stylex.create({
  float: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowTertiary,
    padding: 4,
    position: 'absolute',
    zIndex: 5,
  },
  topCenter: {
    insetBlockStart: 12,
    insetInlineStart: '50%',
    position: 'absolute',
    transform: 'translateX(-50%)',
    zIndex: 5,
  },
  selectionBar: {
    transform: 'translate(-100%, calc(-100% - 36px))',
    zIndex: 6,
  },
});
