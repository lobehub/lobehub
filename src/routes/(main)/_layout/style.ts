import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  // Main container - non-PWA mode (no top border)
  mainContainer: {
    position: 'relative',
  },

  // Main container - PWA mode (with top border)
  mainContainerPWA: {
    position: 'relative',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorder,
  },
});
