import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/** Every picker sits in one right-hand column of this width (tiers and task rows alike). */
export const PICKER_WIDTH = 280;

export const styles = stylex.create({
  desc: {
    color: cssVar.colorTextTertiary,
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.5,
  },
  groupTitle: {
    color: cssVar.colorTextSecondary,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    lineHeight: 1.5,
  },
  hint: {
    color: cssVar.colorTextTertiary,
    flexShrink: 0,
    fontSize: cssVar.fontSizeSM,
  },
  label: {
    color: cssVar.colorText,
    fontSize: cssVar.fontSize,
    fontWeight: 500,
    lineHeight: 1.5,
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
  /** Fixed 40px rows: a 32px picker plus 4px above and below. */
  row: {
    minHeight: 40,
  },
  secondaryText: {
    color: cssVar.colorTextSecondary,
    fontSize: cssVar.fontSize,
    lineHeight: 1.5,
  },
  taskName: {
    color: cssVar.colorText,
    fontSize: cssVar.fontSize,
    lineHeight: 1.5,
  },
  taskNameOff: {
    color: cssVar.colorTextSecondary,
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
