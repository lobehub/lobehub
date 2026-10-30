import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/** The advanced rows' picker column; every task picker ends on the same right edge. */
export const PICKER_WIDTH = 280;

export const styles = stylex.create({
  /** A tier's 「高级」 label: one quiet line under the tier, never a peer of its title. */
  sectionTitle: {
    color: cssVar.colorTextSecondary,
    flex: 'none',
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    lineHeight: 1.5,
  },
  sectionDesc: {
    color: cssVar.colorTextTertiary,
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.5,
  },
  /** A tier's 「高级」 under its picker; the next tier's divider closes it. */
  advanced: {
    paddingBlockEnd: 16,
  },
  /** Compact rows: the picker is 32px, so 40 leaves 4px above and below. */
  row: {
    minHeight: 40,
  },
  taskName: {
    color: cssVar.colorText,
    fontSize: cssVar.fontSize,
    lineHeight: 1.5,
  },
  /** An off task's name drops to secondary, matching its gray value. */
  taskNameOff: {
    color: cssVar.colorTextSecondary,
    fontSize: cssVar.fontSize,
    lineHeight: 1.5,
  },
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
    fontSize: cssVar.fontSize,
    textAlign: 'end',
  },
  /** A pinned model keeps the same right edge as the muted values. */
  valueEnd: {
    display: 'flex',
    justifyContent: 'flex-end',
    minWidth: 0,
  },
});
