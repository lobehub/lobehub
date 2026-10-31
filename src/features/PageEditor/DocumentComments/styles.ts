import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

/** Max rendered height of an image inside the comment composer / edit box. */
export const COMMENT_EDITOR_IMAGE_MAX_HEIGHT = 400;
// The descendant rules that use these heights, and RESIZED_IMAGE_SELECTOR below,
// live in styles.module.css (StyleX cannot reach the editor's DOM); styles.test.ts
// keeps the two in sync.
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

/**
 * The margin marker (`blockMarker`) sits in the body's right margin at the
 * height of the block under the pointer. Its width (`DEFAULT_BLOCK_ANCHOR_PADDING`)
 * and a gutter card's insets (`GUTTER_INSET_*`) are numbers owned by other
 * modules, so their hosts pass them as inline style.
 */
export const styles = stylex.create({
  actions: {
    marginInlineStart: '40px',
    paddingBlockStart: '8px',
    color: cssVar.colorTextTertiary,
  },
  actionsCompact: { marginInlineStart: 0, paddingBlockStart: '4px' },
  /**
   * The quoted run a comment is attached to. Shared by the card and the
   * composer; each host adds its own framing, because what marks the text as
   * quoted differs between them — see `cardAnchor` and `composerAnchor`.
   */
  anchorQuote: { minWidth: 0, color: cssVar.colorTextSecondary },
  /**
   * Hover fills the row rather than recolouring the rule: the fill is what
   * shows how far the hit area actually reaches, which a 2px rule cannot.
   * Resting stays unfilled so a card with a quote doesn't read as two stacked
   * blocks.
   */
  anchorQuoteClickable: {
    cursor: 'pointer',
    transition: `background-color ${cssVar.motionDurationFast}, color ${cssVar.motionDurationFast}`,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: 'none',
  },
  /** Names what the run is; the run itself is the content, so this stays quieter. */
  anchorQuoteLabel: { flex: 'none', color: cssVar.colorTextTertiary },
  /** The quoted run is gone from the body: readable, but no longer a jump target. */
  anchorQuoteOrphaned: { borderInlineStartStyle: 'dashed', color: cssVar.colorTextQuaternary },
  /** `flex: 1` + `min-width: 0` is what lets the quote actually shrink and ellipsise in the row. */
  anchorQuoteText: { flex: '1', minWidth: 0, color: 'inherit' },
  /**
   * The margin marker: sits in the body's right margin at the height of the
   * block under the pointer. Hidden until hover, so a reading column stays
   * clean; the gutter beside it is where the marker's comment will land.
   *
   * The editor column reserves `DEFAULT_BLOCK_ANCHOR_PADDING` on both sides;
   * the block drag handle lives in the start side, the marker takes the end
   * side. Staying inside that padding keeps the marker within the column's
   * own box: placed past the column's edge it would spill out of the scroll
   * pane whenever the column is flush with it (comments panel open), where
   * the panel covers it and the pane grows a horizontal scrollbar.
   */
  blockMarker: {
    position: 'absolute',
    zIndex: 1,
    insetInlineEnd: 0,
    boxSizing: 'border-box',
    paddingInlineStart: '4px',
    color: cssVar.colorTextTertiary,
  },
  body: { marginInlineStart: '40px', paddingBlockStart: '8px', lineHeight: 1.7 },
  bodyCompact: {
    marginInlineStart: 0,
    paddingBlockStart: '6px',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  card: {
    marginInline: '-12px',
    paddingBlockStart: '20px',
    paddingBlockEnd: '12px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadiusLG,
    transition: {
      'default': `background-color 600ms ${cssVar.motionEaseOut}`,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  /**
   * On a card the quote floats in open space, so it carries the quote rule
   * itself. Indented past the comment body's own inset so it reads as the
   * thing being replied to rather than as another paragraph of the comment.
   */
  cardAnchor: {
    marginBlockStart: '8px',
    marginInlineStart: '40px',
    paddingBlock: '4px',
    paddingInlineStart: '10px',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorder,
  },
  /**
   * In the gutter the quote is the card's heading: it names the run the card
   * sits beside, so it goes above the author rather than under it.
   */
  cardAnchorCompact: {
    marginBlockEnd: '8px',
    paddingBlock: '2px',
    paddingInlineStart: '8px',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorder,
  },
  /** A card in the gutter: the surface around it is the card, so the card itself is flush. */
  cardCompact: {
    marginInline: 0,
    paddingBlockStart: 0,
    paddingBlockEnd: 0,
    paddingInline: 0,
  },
  composer: {
    minWidth: 0,
    transition: `border-color ${cssVar.motionDurationFast}, box-shadow ${cssVar.motionDurationFast}`,
    borderColor: { 'default': null, ':focus-within': cssVar.colorPrimary },
    boxShadow: { 'default': null, ':focus-within': `0 0 0 2px ${cssVar.colorPrimaryBg}` },
  },
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
  composerAnchor: {
    paddingBlock: '8px',
    paddingInlineStart: '28px',
    paddingInlineEnd: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  /** The box beside the text: a quiet input, no focus ring — the card around it is the frame. */
  composerPlain: { minWidth: 0 },
  composerAvatar: { flex: 'none', alignSelf: 'flex-start' },
  deleted: { fontStyle: 'italic', color: cssVar.colorTextTertiary },
  /**
   * The comments panel body. It clips a track that mirrors the document's
   * scroll position (see `useGutterLayout`), so cards placed in document
   * coordinates appear beside the text they quote.
   */
  gutter: { position: 'relative', overflow: 'hidden', flex: '1', minHeight: 0 },
  gutterCard: {
    cursor: 'default',
    position: 'absolute',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    // Unmeasured cards wait off-screen at the top rather than flashing at 0.
    visibility: 'hidden',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  /**
   * The card holding the composer is lifted by a shadow instead of framed:
   * the input draws its own frame, and a border around it would read as a
   * box inside a box. Published cards are framed, not lifted.
   */
  gutterCardComposer: { borderColor: 'transparent', boxShadow: cssVar.boxShadowSecondary },
  /**
   * The picked card lifts off the column with the same shadow as the composer
   * card, so the two states the reader is acting on read alike, and wins the
   * stacking order so the lift is not cut by its neighbours.
   */
  gutterCardActive: { zIndex: 1, boxShadow: cssVar.boxShadowSecondary },
  /** Cards glide to a new stack position and ease into the lift; the first placement is instant. */
  gutterCardPositioned: {
    visibility: 'visible',
    transition: {
      'default': `inset-block-start ${cssVar.motionDurationMid} ${cssVar.motionEaseOut}, box-shadow ${cssVar.motionDurationMid} ${cssVar.motionEaseOut}`,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  gutterEmpty: { height: '100%', padding: '24px' },
  /** Rides along with the document: translated by the body's scroll offset. */
  gutterTrack: { position: 'absolute', insetBlockStart: 0, insetInline: 0, height: 0 },
  editComposer: {
    minWidth: 0,
    borderColor: { 'default': null, ':focus-within': cssVar.colorPrimary },
    boxShadow: { 'default': null, ':focus-within': `0 0 0 2px ${cssVar.colorPrimaryBg}` },
  },
  header: { minHeight: '32px' },
  /** A narrow card stacks name over time beside the avatar. */
  headerCompact: { minHeight: '28px' },
  /** Applied briefly when a notification deep link lands on the card. */
  highlighted: { backgroundColor: cssVar.colorPrimaryBg },
  meta: { color: cssVar.colorTextTertiary },
  replyBody: { marginInlineStart: '36px' },
  replyCard: { paddingBlockStart: '12px', paddingBlockEnd: '8px' },
  replyCardActions: { marginInlineStart: '36px' },
  replyList: { marginInlineStart: '40px', paddingBlock: '4px', paddingInlineStart: '16px' },
  /** Replies in a panel card list flat under the root, separated by rhythm alone. */
  replyListCompact: {
    marginBlockStart: '4px',
    marginInlineStart: 0,
    paddingInlineStart: 0,
    borderInlineStartWidth: 0,
  },
  replyTargetIcon: { flex: 'none', color: cssVar.colorTextQuaternary },
  section: { width: '100%', marginBlockStart: '64px', paddingBlockEnd: '80px' },
  textarea: {
    resize: 'none',
    padding: 0,
    fontSize: cssVar.fontSize,
    lineHeight: cssVar.lineHeight,
  },
  thread: {
    paddingBlockEnd: '20px',
    borderBlockEndWidth: { 'default': '1px', ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  threadCompact: { gap: '4px', paddingBlockEnd: 0, borderBlockEndWidth: 0 },
  threadList: { gap: '8px' },
});

/** The `highlighted` rule as class names, for elements that are flashed through `classList`. */
export const HIGHLIGHTED_CLASS_NAMES = (stylex.props(styles.highlighted).className ?? '')
  .split(' ')
  .filter(Boolean);

/** Composer host classes, resolved once for components that take a plain `className`. */
export const composerClassNames = {
  avatar: stylex.props(styles.composerAvatar).className,
  input: stylex.props(styles.composer).className,
  plain: stylex.props(styles.composerPlain).className,
};
