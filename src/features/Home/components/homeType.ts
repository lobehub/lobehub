import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/**
 * The home surface's type scale. Every text role on the page resolves to exactly
 * one entry here — the sizes previously lived inline in eight files and had
 * drifted into five sizes covering overlapping roles (a 15px and a 14px item
 * title, three sizes of supporting text).
 *
 * Section labels are deliberately the smallest text on the page: the page reads
 * content-first, so a group heading identifies its pile without competing with
 * the items in it.
 */
export const homeType = stylex.create({
  /** Counts riding next to a section label. */
  badge: {
    fontSize: '12px',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    color: cssVar.colorTextTertiary,
  },
  /** The name of a thing you can open: a task, a brief, a topic. */
  itemTitle: {
    fontSize: '15px',
    fontWeight: 500,
    lineHeight: '22px',
    color: cssVar.colorText,
  },
  /** An item whose title is a sentence rather than a name (suggestions). */
  itemTitleProse: {
    fontSize: '15px',
    fontWeight: 400,
    lineHeight: '22px',
    color: cssVar.colorText,
  },
  /** Timestamps, identifiers, refs — glanced at, never read. */
  meta: {
    fontSize: '12px',
    fontWeight: 400,
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
  },
  /** Group / card headings. */
  sectionLabel: {
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    letterSpacing: '0.04em',
  },
  /** The second line of a row — meant to be read, not just scanned. */
  supporting: {
    fontSize: '13px',
    fontWeight: 400,
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
  },
});
