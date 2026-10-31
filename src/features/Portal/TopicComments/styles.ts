import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  anchor: {
    cursor: 'pointer',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorder,
    borderStartStartRadius: 0,
    borderStartEndRadius: cssVar.borderRadius,
    borderEndEndRadius: cssVar.borderRadius,
    borderEndStartRadius: 0,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  // The quoted message is gone: not a jump target, so hover does not react.
  anchorDisabled: {
    cursor: 'default',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  body: { overflow: 'hidden', flex: '1', minHeight: 0 },
  // The card is the marker that reveals `cardActions` on hover.
  card: {
    position: 'relative',
    paddingBlock: '14px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  cardActions: {
    position: 'absolute',
    insetBlockStart: '8px',
    insetInlineEnd: 0,
    opacity: {
      'default': 1,
      '@media (hover: hover)': {
        default: 0,
        [stylex.when.ancestor(':hover')]: 1,
      },
    },
    transition: `opacity ${cssVar.motionDurationFast}`,
  },
  composer: {
    flexShrink: 0,
    marginBlockStart: '12px',
    marginBlockEnd: '16px',
    marginInline: '16px',
  },
  deleted: { fontStyle: 'italic', color: cssVar.colorTextTertiary },
  editEditor: {
    paddingBlock: '8px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorder, ':focus-within': cssVar.colorPrimary },
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  edited: { color: cssVar.colorTextTertiary },
  empty: { flex: '1', minHeight: '240px' },
  list: {
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    flex: '1',
    minHeight: 0,
    paddingInline: '16px',
  },
  moderatedContent: { opacity: 0.62 },
  reply: {
    marginInlineStart: '20px',
    paddingInlineStart: '12px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
});
