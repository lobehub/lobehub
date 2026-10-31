import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  actionBtn: {
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    borderColor: { 'default': null, ':hover': cssVar.colorBorder },
  },
  actionBtnPrimary: {
    paddingInline: '12px',
    width: 'auto',
  },
  // A card is a `stylex.defaultMarker()` element: `revealOnCardHover` descendants
  // are hidden until it is hovered.
  card: {
    borderColor: { 'default': null, ':hover': cssVar.colorBorder },
  },
  clickableHeader: {
    cursor: 'pointer',
  },
  expandLink: {
    borderColor: cssVar.colorFillTertiary,
    borderStyle: 'solid',
    borderWidth: '1px',
    color: cssVar.colorTextDescription,
    fontSize: '12px',
  },
  resolvedTag: {
    color: cssVar.colorTextQuaternary,
    fontSize: '13px',
  },
  revealOnCardHover: {
    opacity: { default: null, [stylex.when.ancestor(':not(:hover)')]: 0 },
  },
});
