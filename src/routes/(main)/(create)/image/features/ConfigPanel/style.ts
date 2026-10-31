import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const configPanelStyles = stylex.create({
  dragOver: {
    transform: 'scale(1.02)',
    borderColor: cssVar.colorPrimary,
    boxShadow: `0 0 0 2px color-mix(in srgb, ${cssVar.colorPrimary} 12.5%, transparent)`,
  },
});
