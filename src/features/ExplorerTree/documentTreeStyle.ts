import { FILE_ICON_OFFSET_VAR, HIDE_FILE_SLOT_SVG_CSS, svgMaskUrl } from './folderIconStyle';

// Layout + icon + hierarchy styling for the document-facing tree (agent
// documents explorer). The code trees (project Files, review diff) intentionally
// stay IDE-dense and keep the colored material icon set, so these tokens live
// apart from pierre's defaults rather than overriding `--trees-*` globally.

export const DOCUMENT_TREE_LAYOUT = {
  /** Gap between the icon slot and the label — also the guide/indent rhythm. */
  iconGap: 8,
  /** Both glyphs render at this size so a folder never reads heavier than a file. */
  iconSize: 16,
  /** Matches pierre's `--trees-icon-width` default; kept explicit so the
   *  reserved file-icon offset can be derived from the same number. */
  iconWidth: 16,
  /** Row height and label size are the sidebar `NavItem`'s (36px / 14px), so a
   *  document row and a nav row read as the same kind of list item. */
  itemHeight: 36,
  fontSize: 14,
  /** Horizontal step per nesting level. The rendered step is this plus pierre's
   *  own per-level padding, so 8 lands each level ~23.5px in. */
  levelGap: 8,
} as const;

// Both glyphs are lucide outlines at the same stroke weight, painted as CSS
// masks so they inherit one themed color. The material folder sprites the code
// trees use are filled and multi-colored — next to a monochrome outline file
// glyph a folder row reads as a much heavier object than its own children,
// which is the wrong hierarchy signal for a document outline.
const STROKE =
  'fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const svg = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ${STROKE}>${paths}</svg>`;

// lucide `file-text`, matched to the Pages (文稿) list item icon so document
// rows read as manuscripts rather than generic files.
const FILE_TEXT_ICON_SVG = svg(
  '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
);

// lucide `folder` / `folder-open`.
const FOLDER_ICON_SVG = svg(
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
);
const FOLDER_OPEN_ICON_SVG = svg(
  '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
);

const ICON_FG_VAR = '--explorer-tree-icon-fg';
const { iconGap, iconSize } = DOCUMENT_TREE_LAYOUT;

const maskGlyph = (glyph: string) => `
    background-color: var(${ICON_FG_VAR}, currentColor);
    -webkit-mask-image: ${svgMaskUrl(glyph)};
    -webkit-mask-position: center;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-size: ${iconSize}px ${iconSize}px;
    mask-image: ${svgMaskUrl(glyph)};
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: ${iconSize}px ${iconSize}px;
`;

export const DOCUMENT_TREE_ICON_CSS = `
  [data-item-type='folder'] [data-item-section='content'] {
    display: flex;
    align-items: center;
  }

  /* The chevron owns the icon slot on a folder row, so the folder glyph is
     painted as the label's ::before. Its trailing gap matches the row gap the
     file glyph gets, so both kinds of row have the same glyph→label rhythm. */
  [data-item-type='folder'] [data-item-section='content']::before {
    content: '';
    flex: 0 0 auto;
    width: ${iconSize}px;
    height: ${iconSize}px;
    margin-inline-end: ${iconGap}px;
${maskGlyph(FOLDER_ICON_SVG)}  }

  [data-item-type='folder'][aria-expanded='true'] [data-item-section='content']::before {
${maskGlyph(FOLDER_OPEN_ICON_SVG)}  }

  [data-item-type='file'] > [data-item-section='icon'] {
    margin-inline-start: var(${FILE_ICON_OFFSET_VAR}, 0px);
${maskGlyph(FILE_TEXT_ICON_SVG)}  }

${HIDE_FILE_SLOT_SVG_CSS}
`;

// A row already reads as current from its filled background, so the outline
// pierre paints on the focused row is redundant chrome — a stray 1px ring around
// whichever row was last clicked. Drop it in every state, including
// :focus-visible: pierre marks a row focus-visible after a plain mouse click, so
// gating on that still leaves the ring the user sees.
//
// Keyboard focus must stay visible without it. A focused row that is not also
// selected carries no background of its own, so give it the hover fill —
// arrowing through the tree then reads the same way hovering it does.
const DOCUMENT_TREE_NO_FOCUS_BORDER_CSS = `
  [data-type='item'][data-item-focused='true']::before,
  [data-type='item']:focus-visible::before {
    outline: none;
  }

  [data-type='item'][data-item-focused='true']:not([data-item-selected='true']) {
    background-color: var(--trees-bg-muted);
  }
`;

// pierre truncates every row with `MiddleTruncate split:"extension"` and no way
// to configure it (FileTreeView hard-codes it; FileTreeOptions has no field for
// truncation). The stem is rendered as a shrink-first segment and the extension
// as a shrink-last one, so a long title collapses to `…承载md` — the ellipsis
// lands mid-word and the extension survives, which is backwards for a document
// outline where the title is the content and `.md` is storage detail.
//
// The split itself is only a flex priority in pierre's own stylesheet, so
// swapping the two priorities is enough: the stem now holds its width and the
// extension collapses to its own leading marker, which renders as one trailing
// ellipsis. A title that fits is untouched — both halves render in full.
const DOCUMENT_TREE_TRAILING_ELLIPSIS_CSS = `
  [data-item-section='content'] [data-truncate-group-container='middle'] {
    & > div[data-truncate-segment-priority='1'] {
      flex: 0 999999 max-content;
    }

    & > div[data-truncate-segment-priority='2'] {
      flex: 0 1 max-content;
    }
  }

  /* The swap leaves a narrow band where the overflow is smaller than the
     extension: it then shrinks to a few pixels and, being right-aligned, leaks
     its last character ("…研究报告 d"). pierre's own overflow query fires on that
     segment, so stretch its marker across the segment — the marker is opaque and
     sits above the text, so a partially rendered extension is covered rather
     than half-shown. A fully collapsed one is zero-wide and stays invisible. */
  @container measure (height > 1lh) {
    [data-item-section='content'] [data-truncate-container='fruncate'] [data-truncate-marker] {
      inset: 0;
      justify-content: flex-start;
    }
  }

  /* pierre paints the marker over the last characters and masks them with
     --truncate-marker-background-color, which defaults to --trees-bg. These rows
     are transparent so the panel shows through, and the ellipsis ended up drawn
     on top of the text. Point the marker at the panel's own background so it
     masks again, without giving the rows an opaque fill of their own. */
  [data-type='item'] {
    --truncate-marker-background-color: var(--explorer-tree-panel-bg, transparent);
  }

`;

// Row presentation for the document tree. Nesting is carried by indentation
// alone — no indent guides — with folder rows a little heavier so a parent still
// reads as a parent once its children have scrolled it out of view. Every label
// keeps the primary text color: a document row is a destination, not chrome.
export const DOCUMENT_TREE_ROW_CSS = `
  [data-item-type='folder'] > [data-item-section='content'] {
    font-weight: 500;
  }

${DOCUMENT_TREE_NO_FOCUS_BORDER_CSS}
${DOCUMENT_TREE_TRAILING_ELLIPSIS_CSS}
`;
