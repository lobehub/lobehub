import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  container: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 50,
    insetBlockEnd: '16px',
    insetInlineEnd: '16px',
    transform: 'translateY(16px)',
    opacity: 0,
    backdropFilter: 'saturate(150%) blur(10px)',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgElevated} 50%, transparent)`,
    backgroundImage: 'none',
  },
  visible: {
    pointerEvents: 'all',
    transform: 'translateY(0)',
    opacity: 1,
  },
});
