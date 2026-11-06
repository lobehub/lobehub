import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  // Inner container - dark mode
  innerContainerDark: {
    position: 'relative',
    overflowX: 'hidden',
    overflowY: 'auto',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },

  // Inner container - light mode
  innerContainerLight: {
    position: 'relative',
    overflowX: 'hidden',
    overflowY: 'auto',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },

  innerContainerMobile: {
    position: 'relative',
    overflowX: 'hidden',
    overflowY: 'auto',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },

  // Outer container
  outerContainer: {
    position: 'relative',
  },
});
