import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  // Absolutely positioned container, fills parent
  absoluteContainer: {
    position: 'absolute',
    inset: 0,
  },

  // Content area - dark mode
  contentDark: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
    backgroundImage: `linear-gradient(to bottom, ${cssVar.colorBgContainer}, var(--content-bg-secondary, ${cssVar.colorBgContainer}))`,
  },

  // Content area - light mode
  contentLight: {
    overflow: 'hidden',
    backgroundColor: `var(--content-bg-secondary, ${cssVar.colorBgContainer})`,
    backgroundImage: 'none',
  },
});
