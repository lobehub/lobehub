import { createStaticStyles, cssVar } from 'antd-style';

import { GUTTER_INSET_END, GUTTER_INSET_START } from './Gutter/constants';

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
  actionsCompact: css`
    margin-inline-start: 0;
    padding-block-start: 4px;
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
  /**
   * The margin marker: sits in the body's right margin at the height of the
   * block under the pointer. Hidden until hover, so a reading column stays
   * clean; the gutter beside it is where the marker's comment will land.
   */
  blockMarker: css`
    position: absolute;
    z-index: 1;

    /*
     * A physical transform (translateX) can't flip with direction, so
     * "just past the inline-end edge" is expressed purely with insets
     * instead of inset-inline-end + translateX(100%): pinning the
     * inline-start edge at 100% of the container's width places the box
     * flush against, and extending from, the inline-end edge either way.
     */
    inset-inline-start: 100%;

    padding-inline-start: 4px;

    color: ${cssVar.colorTextTertiary};
  `,
  body: css`
    margin-inline-start: 40px;
    padding-block-start: 8px;
    line-height: 1.7;
  `,
  bodyCompact: css`
    margin-inline-start: 0;
    padding-block-start: 6px;
    font-size: 14px;
    line-height: 1.6;
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
  /**
   * In the gutter the quote is the card's heading: it names the run the card
   * sits beside, so it goes above the author rather than under it.
   */
  cardAnchorCompact: css`
    margin-block-end: 8px;
    padding-block: 2px;
    padding-inline-start: 8px;
    border-inline-start: 2px solid ${cssVar.colorBorder};
  `,
  /** A card in the gutter: the surface around it is the card, so the card itself is flush. */
  cardCompact: css`
    margin-inline: 0;
    padding: 0;
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
  /**
   * Beside the text the box is narrow and the caret should start where the
   * action bar's first icon starts: ChatInput's own 12px is the whole inset.
   */
  commentEditorFlush: css`
    padding-inline: 0;
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
  /** The box beside the text: a quiet input, no focus ring — the card around it is the frame. */
  composerPlain: css`
    min-width: 0;
  `,
  composerAvatar: css`
    flex: none;
    align-self: flex-start;
  `,
  deleted: css`
    font-style: italic;
    color: ${cssVar.colorTextTertiary};
  `,
  /**
   * The comments panel body. It clips a track that mirrors the document's
   * scroll position (see `useGutterLayout`), so cards placed in document
   * coordinates appear beside the text they quote.
   */
  gutter: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  `,
  gutterCard: css`
    cursor: default;

    position: absolute;
    inset-inline: ${GUTTER_INSET_START}px ${GUTTER_INSET_END}px;

    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    /* Unmeasured cards wait off-screen at the top rather than flashing at 0. */
    visibility: hidden;
    background: ${cssVar.colorBgElevated};
  `,
  /**
   * The card holding the composer is lifted by a shadow instead of framed:
   * the input draws its own frame, and a border around it would read as a
   * box inside a box. Published cards are framed, not lifted.
   */
  gutterCardComposer: css`
    border-color: transparent;
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  /**
   * The picked card lifts off the column with the same shadow as the composer
   * card, so the two states the reader is acting on read alike, and wins the
   * stacking order so the lift is not cut by its neighbours.
   */
  gutterCardActive: css`
    z-index: 1;
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  /** Cards glide to a new stack position and ease into the lift; the first placement is instant. */
  gutterCardPositioned: css`
    visibility: visible;
    transition:
      inset-block-start ${cssVar.motionDurationMid} ${cssVar.motionEaseOut},
      box-shadow ${cssVar.motionDurationMid} ${cssVar.motionEaseOut};

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  gutterEmpty: css`
    height: 100%;
    padding: 24px;
  `,
  /** Rides along with the document: translated by the body's scroll offset. */
  gutterTrack: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline: 0;
    height: 0;
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
  /** A narrow card stacks name over time beside the avatar. */
  headerCompact: css`
    min-height: 28px;
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
  /** Replies in a panel card list flat under the root, separated by rhythm alone. */
  replyListCompact: css`
    margin-block-start: 4px;
    margin-inline-start: 0;
    padding-inline-start: 0;
    border-inline-start: 0;
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
  threadCompact: css`
    gap: 4px;
    padding-block-end: 0;
    border-block-end: 0;
  `,
  threadList: css`
    gap: 8px;
  `,
}));
