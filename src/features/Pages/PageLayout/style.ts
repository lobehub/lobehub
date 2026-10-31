import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  // Main container
  mainContainer: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});
