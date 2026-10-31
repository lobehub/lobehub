import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  actions: {
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineEnd: '16px',
    transform: 'translateY(-50%)',
  },
  // Same pair `lobeStaticStylish.active` painted: the hover state of the row
  // is restated because replacing `color` / `backgroundColor` drops the root's.
  active: {
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFill },
    backgroundImage: 'none',
  },
  content: {
    position: 'relative',
    overflow: 'hidden',
    flex: '1',
    alignSelf: 'center',
  },
  date: {
    fontSize: '12px',
    color: cssVar.colorTextPlaceholder,
  },
  desc: {
    width: '100%',
    margin: 0,
    fontSize: '12px',
    lineHeight: 1.2,
    color: cssVar.colorTextDescription,
  },

  pin: {
    position: 'absolute',
    insetBlockStart: '6px',
    insetInlineEnd: '6px',
  },
  // `lobeStaticStylish.variantBorderless` plus the row's own box.
  root: {
    cursor: 'pointer',
    position: 'relative',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextTertiary,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    boxShadow: 'none',
  },

  title: {
    width: '100%',
    margin: 0,
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1.2,
    color: cssVar.colorText,
  },
  triangle: {
    width: '10px',
    height: '10px',
    borderRadius: '2px',
    opacity: 0.5,
    backgroundColor: cssVar.colorPrimaryBorder,
    backgroundImage: 'none',
    clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%)',
  },
});
