import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  body: {
    paddingBlockEnd: { default: null, [media.sm]: '68px' },
  },
  footer: {
    position: { default: null, [media.sm]: 'absolute' },
    insetBlockEnd: { default: null, [media.sm]: 0 },
    insetInline: { default: null, [media.sm]: 0 },
    width: { default: null, [media.sm]: '100%' },
    margin: { default: null, [media.sm]: 0 },
    padding: { default: null, [media.sm]: '16px' },
    backgroundColor: { default: null, [media.sm]: cssVar.colorBgContainer },
    backgroundImage: { default: null, [media.sm]: 'none' },
  },
  preview: {
    overflowX: 'hidden',
    overflowY: 'scroll',
    width: '100%',
    maxHeight: { default: '70dvh', [media.sm]: '40dvh' },
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  sidebar: {
    flex: { default: 'none', [media.sm]: '1' },
    width: { default: 'max(240px, 25%)', [media.sm]: 'unset' },
    marginInline: { default: null, [media.sm]: '-16px' },
  },
});
