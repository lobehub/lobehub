import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  /** The model a follow item currently means, next to it in the menu. */
  hint: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
    fontSize: cssVar.fontSizeSM,
  },
  /** 「不启用」 sits under a divider; Select options have no divider item, so the option draws it. */
  offOption: {
    'marginBlockStart': 9,
    'overflow': 'visible',
    'position': 'relative',
    '::before': {
      backgroundColor: cssVar.colorBorderSecondary,
      content: '""',
      height: 1,
      insetBlockStart: -5,
      insetInlineEnd: 0,
      insetInlineStart: 0,
      position: 'absolute',
    },
  },
  /**
   * The picker wraps the rendered value in a content-sized span; as a grid item
   * that span stretches over the trigger, so values and hints can align to its
   * right edge.
   */
  triggerValue: {
    display: 'grid',
    flex: '1',
    gridTemplateColumns: 'minmax(0, 1fr)',
    minWidth: 0,
  },
  /** A follow / off value: gray, no icon, right-aligned against the arrow. */
  valueMuted: {
    color: cssVar.colorTextTertiary,
    display: 'block',
    textAlign: 'end',
  },
  /** A pinned model keeps the same right edge as the muted values. */
  valueEnd: {
    display: 'flex',
    justifyContent: 'flex-end',
    minWidth: 0,
  },
});
