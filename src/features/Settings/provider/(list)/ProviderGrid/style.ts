import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  containerDark: {
    position: 'relative',
    overflow: 'hidden',
    height: '100%',
    borderRadius: '12px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: {
      'default': `0 0 1px 1px ${cssVar.colorFillQuaternary} inset`,
      ':hover': `0 0 1px 1px ${cssVar.colorFillSecondary} inset`,
    },
    transition: `box-shadow 0.2s ${cssVar.motionEaseInOut}`,
  },
  containerLight: {
    position: 'relative',
    overflow: 'hidden',
    height: '100%',
    borderRadius: '12px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: {
      'default': `0 0 1px 1px ${cssVar.colorFillSecondary} inset`,
      ':hover': `0 0 1px 1px ${cssVar.colorFill} inset`,
    },
    transition: `box-shadow 0.2s ${cssVar.motionEaseInOut}`,
  },
  desc: {
    minHeight: '44px',
    marginBlockEnd: '0 !important',
    color: cssVar.colorTextDescription,
  },
});
