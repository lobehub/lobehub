import { createStaticStyles } from 'antd-style';

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
export const homeType = createStaticStyles(({ css, cssVar }) => ({
  /** Counts riding next to a section label. */
  badge: css`
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
  `,
  /** The name of a thing you can open: a task, a brief, a topic. */
  itemTitle: css`
    font-size: 15px;
    font-weight: 500;
    line-height: 22px;
    color: ${cssVar.colorText};
  `,
  /** An item whose title is a sentence rather than a name (suggestions). */
  itemTitleProse: css`
    font-size: 15px;
    font-weight: 400;
    line-height: 22px;
    color: ${cssVar.colorText};
  `,
  /** Timestamps, identifiers, refs — glanced at, never read. */
  meta: css`
    font-size: 12px;
    font-weight: 400;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
  /** Group / card headings. */
  sectionLabel: css`
    font-size: 12px;
    font-weight: 600;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
    letter-spacing: 0.04em;
  `,
  /** The second line of a row — meant to be read, not just scanned. */
  supporting: css`
    font-size: 13px;
    font-weight: 400;
    line-height: 20px;
    color: ${cssVar.colorTextTertiary};
  `,
}));
