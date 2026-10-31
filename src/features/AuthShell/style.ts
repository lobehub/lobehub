import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  innerContainerDark: {
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: '1px',
    overflow: 'hidden',
    position: 'relative',
  },
  innerContainerLight: {
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: '1px',
    overflow: 'hidden',
    position: 'relative',
  },
  outerContainer: {
    position: 'relative',
  },
});
