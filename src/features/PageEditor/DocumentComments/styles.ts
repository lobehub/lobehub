import { createStaticStyles, cssVar } from 'antd-style';

/** Max rendered height of an image inside the comment composer / edit box. */
export const COMMENT_EDITOR_IMAGE_MAX_HEIGHT = 400;
/** Max rendered height of an image inside a published comment. */
export const COMMENT_CONTENT_IMAGE_MAX_HEIGHT = 480;

/**
 * Comment boxes grow with their content indefinitely (Yuque-style) — the page
 * scrolls, the box never scrolls internally. `ChatInput` applies a 320px cap
 * by default, so pass this effectively-unbounded value to neutralize it.
 */
export const COMMENT_INPUT_MAX_HEIGHT = 100_000;

/**
 * An image the user has explicitly resized. The editor's image plugin writes
 * the dragged width to the `<img>` inline style (`width: 320px`) while an
 * untouched image carries `width: inherit`; `LexicalRenderer` (published
 * comments) only inlines `width` once the node has one. `width` may be the
 * first declaration (a node without `maxWidth` renders `style="width: 320px"`)
 * or follow `max-width`, so both the start-of-value and the leading-space forms
 * are matched; `max-width` itself never matches either form. This is the one
 * signal that separates "user picked a size" from "thumbnail default".
 */
export const RESIZED_IMAGE_SELECTOR =
  'img:is([style^="width:"], [style*=" width:"]):not([style^="width: inherit"]):not([style*=" width: inherit"])';

const RESIZED_IMAGE = RESIZED_IMAGE_SELECTOR;

export const styles = createStaticStyles(({ css }) => ({
  actions: css`
    margin-inline-start: 40px;
    padding-block-start: 8px;
    color: ${cssVar.colorTextTertiary};
  `,
  /**
   * The quoted run a comment is attached to. Shared by the card and the
   * composer; each host adds its own framing, because what marks the text as
   * quoted differs between them — see `cardAnchor` and `composerAnchor`.
   */
  anchorQuote: css`
    min-width: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  /**
   * Hover fills the row rather than recolouring the rule: the fill is what
   * shows how far the hit area actually reaches, which a 2px rule cannot.
   * Resting stays unfilled so a card with a quote doesn't read as two stacked
   * blocks.
   */
  anchorQuoteClickable: css`
    cursor: pointer;
    transition:
      background-color ${cssVar.motionDurationFast},
      color ${cssVar.motionDurationFast};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  /** Names what the run is; the run itself is the content, so this stays quieter. */
  anchorQuoteLabel: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  /** The quoted run is gone from the body: readable, but no longer a jump target. */
  anchorQuoteOrphaned: css`
    border-inline-start-style: dashed;
    color: ${cssVar.colorTextQuaternary};
  `,
  /** `flex: 1` + `min-width: 0` is what lets the quote actually shrink and ellipsise in the row. */
  anchorQuoteText: css`
    flex: 1;
    min-width: 0;
    color: inherit;
  `,
  body: css`
    margin-inline-start: 40px;
    padding-block-start: 8px;
    line-height: 1.7;
  `,
  card: css`
    margin-inline: -12px;
    padding-block: 20px 12px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};

    transition: background-color 600ms ${cssVar.motionEaseOut};

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  /**
   * On a card the quote floats in open space, so it carries the quote rule
   * itself. Indented past the comment body's own inset so it reads as the
   * thing being replied to rather than as another paragraph of the comment.
   */
  cardAnchor: css`
    margin-block-start: 8px;
    margin-inline-start: 40px;
    padding-block: 4px;
    padding-inline-start: 10px;
    border-inline-start: 2px solid ${cssVar.colorBorder};
  `,
  commentContent: css`
    /* Published comments render images as left-aligned thumbnails: the
       renderer inlines the stored (natural) width, which would otherwise span
       the whole column. */
    & figure:has(> img) {
      margin-block: 8px;
      text-align: start;
    }

    & img {
      max-width: 100% !important;
      height: auto !important;
    }

    /* Thumbnail default only for images the author never resized — a stored
       width is the author's choice and is honoured exactly like the body. */
    & img:not(${RESIZED_IMAGE}) {
      width: auto !important;
      max-height: ${COMMENT_CONTENT_IMAGE_MAX_HEIGHT}px;
    }
  `,
  commentEditor: css`
    min-width: 0;

    /* Horizontal breathing room for the editor body, on top of ChatInput's own
       12px. Kept out of the editor's style prop: the editor forwards that prop
       to its absolutely positioned placeholder too, so any inline padding
       there would push the placeholder past the caret. */
    padding-inline: 16px;

    /* The placeholder carries a 4px top margin meant to mirror a paragraph's
       default margin; the first block below has that margin removed, so drop
       the placeholder's as well to keep it on the caret line. It is an
       absolutely positioned later sibling of the editable area, after a
       couple of empty plugin slots, hence the general sibling selector. */
    & [contenteditable='true'] ~ div {
      margin-block-start: 0 !important;
    }

    /* Rich Markdown blocks carry document margins by default. A chat input
       keeps only inter-block rhythm so the first typed heading never jumps. */
    & [contenteditable='true'] > :first-child {
      margin-block-start: 0 !important;
    }

    & [contenteditable='true'] > :last-child {
      margin-block-end: 0 !important;
    }

    /* The image plugin sizes a pasted image at its natural width with no
       height bound. Comments keep images generous (near full column width,
       like the document body) but aspect-preserving and height-capped, and
       left-aligned like the text with breathing room above and below. */
    & [contenteditable='true'] :has(> img) {
      width: auto !important;
      max-width: 100% !important;
      text-align: start;
    }

    & [contenteditable='true'] > div:has(img) {
      margin-block: 8px;
      text-align: start;
    }

    & [contenteditable='true'] img {
      max-width: 100% !important;
      height: auto !important;
    }

    /* Only untouched images get the thumbnail treatment. Forcing width: auto
       on every image would beat the inline width the resize handles write, so
       dragging would appear to do nothing. */
    & [contenteditable='true'] img:not(${RESIZED_IMAGE}) {
      width: auto !important;
      max-height: ${COMMENT_EDITOR_IMAGE_MAX_HEIGHT}px;
    }
  `,
  composer: css`
    min-width: 0;
    transition:
      border-color ${cssVar.motionDurationFast},
      box-shadow ${cssVar.motionDurationFast};

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
  `,
  /**
   * In the composer the input's own border already frames the quote, so it
   * takes a bottom hairline instead of a quote rule — a rule here would sit
   * flush against that border and read as a rendering artifact rather than as
   * a quote mark.
   *
   * ChatInput gives its header slot no horizontal padding while the body sits
   * at 12px (ChatInput) + 16px (`commentEditor`), so the inset is restated
   * here; without it the quote hangs left of the comment being written.
   */
  composerAnchor: css`
    padding-block: 8px;
    padding-inline: 28px 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  composerAvatar: css`
    flex: none;
    align-self: flex-start;
  `,
  deleted: css`
    font-style: italic;
    color: ${cssVar.colorTextTertiary};
  `,
  editComposer: css`
    min-width: 0;

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
  `,
  header: css`
    min-height: 32px;
  `,
  /* Applied briefly when a notification deep link lands on the card. */
  highlighted: css`
    background-color: ${cssVar.colorPrimaryBg};
  `,
  meta: css`
    color: ${cssVar.colorTextTertiary};
  `,
  replyBody: css`
    margin-inline-start: 36px;
  `,
  replyCard: css`
    padding-block: 12px 8px;
  `,
  replyCardActions: css`
    margin-inline-start: 36px;
  `,
  replyList: css`
    margin-inline-start: 40px;
    padding-block: 4px;
    padding-inline-start: 16px;
  `,
  replyTargetIcon: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
  `,
  section: css`
    width: 100%;
    margin-block-start: 64px;
    padding-block-end: 80px;
  `,
  textarea: css`
    resize: none;
    padding: 0;
    font-size: ${cssVar.fontSize};
    line-height: ${cssVar.lineHeight};
  `,
  thread: css`
    padding-block-end: 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: 0;
    }
  `,
  threadList: css`
    gap: 8px;
  `,
}));
