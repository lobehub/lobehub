import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const floatStyles = stylex.create({
  float: {
    backgroundColor: cssVar.colorBgElevated,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowTertiary,
    padding: 4,
    position: 'absolute',
    zIndex: 5,
  },
  bar: {
    alignItems: 'center',
    display: 'flex',
    fontSize: 13,
    gap: 2,
    padding: 3,
  },
  divider: {
    backgroundColor: cssVar.colorBorderSecondary,
    flex: 'none',
    height: 18,
    marginInline: 4,
    width: 1,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: {
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
    borderRadius: 8,
    color: cssVar.colorText,
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: 4,
    height: 30,
    paddingInlineEnd: 8,
    paddingInlineStart: 10,
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
