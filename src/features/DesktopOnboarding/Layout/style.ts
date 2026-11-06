import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  contentContainer: { overflow: 'auto' },

  // Inner container - dark mode
  innerContainerDark: {
    position: 'relative',
    overflow: 'hidden',
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
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },

  // macOS windows with large corner radii round the diagonal corners further
  innerContainerLargeWindowBorders: {
    borderTopRightRadius: '12px',
    borderBottomLeftRadius: '12px',
  },

  // Outer container
  outerContainer: { position: 'relative' },
});
