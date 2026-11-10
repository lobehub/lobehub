import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  badge: {
    paddingBlock: '4px',
    paddingInline: '6px',
    borderRadius: '2222px',
    fontSize: '12px',
    lineHeight: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  container: {
    cursor: 'pointer',
    width: 'fit-content',
    paddingBlock: '6px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '12px',
    borderRadius: '8px',
    color: cssVar.colorText,
    backgroundImage: 'none',
    boxShadow: { 'default': cssVar.boxShadowTertiary, ':hover': cssVar.boxShadowSecondary },
    transition: 'all 0.2s',
  },
  containerDark: {
    backgroundColor: {
      'default': `color-mix(in srgb, ${cssVar.colorBgElevated} 90%, white)`,
      ':hover': `color-mix(in srgb, ${cssVar.colorBgElevated} 85%, white)`,
    },
    backgroundImage: 'none',
  },
  containerLight: {
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgElevated} 90%, white)`,
    backgroundImage: 'none',
  },
});
