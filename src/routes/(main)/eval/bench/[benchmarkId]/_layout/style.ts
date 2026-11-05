import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  mainContainer: {
    position: 'relative',
    overflow: 'auto',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});
