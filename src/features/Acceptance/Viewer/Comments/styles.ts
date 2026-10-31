import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { timelineEntryMarker } from '../markers.stylex';

/**
 * Two comment surfaces, deliberately different.
 *
 * The discussion is an activity feed, Linear-style: no rail and no boxes. A
 * remark is an author line with its words indented under the avatar; an event
 * is one grey line. Rounds, not frames, give the feed its structure. No colour
 * anywhere — an author's colour belongs on the marks they drew.
 *
 * A region note is a Figma-style pin: no frame at all, just an elevated surface
 * floating beside the screenshot.
 */
export const TIMELINE_NODE = 20;
export const NODE_GUTTER = 8;
const EVENT_DOT = 20;
const ENTRY_GAP = 10;

/**
 * The accent, diluted well past the reference. A blue box line reads much
 * heavier than the same blue on GitHub's does, because everything around it
 * here is a near-black surface with a near-black border.
 */
const SELF_BORDER = `color-mix(in srgb, ${cssVar.colorInfoBorder} 45%, transparent)`;

export const styles = stylex.create({
  body: {
    // A one-line remark in a header-topped box read as a sliver; GitHub's
    // comment bodies always have room to breathe under the author line.
    minHeight: '80px',
    paddingBlock: '12px',
    paddingInline: '14px',
    fontSize: '14px',
    lineHeight: 1.7,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  /** A discussion message: header strip, then the words. */
  box: {
    position: 'relative',
    flex: '1',
    minWidth: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
  },
  /**
   * Your own turn, the way GitHub marks it: the box line picks up the accent
   * blue and the header strip takes a matching tint. In a two-person review you
   * scan for what the other side said, and that only works if your own remarks
   * are identifiable without reading the names.
   *
   * A line and nothing else. Every fill this box ever had — the header strip,
   * then the accent tint on top of it — read as decoration once the rest of the
   * discussion had none.
   */
  boxSelf: {
    borderColor: SELF_BORDER,
  },
  /**
   * The author line, over the words. No fill and no divider: a strip of tinted
   * surface with a rule under it framed every remark like a table row. The
   * padding stays, so the line still reads as its own band.
   */
  boxHeader: {
    paddingBlock: '8px',
    paddingInline: '14px',
    borderStartStartRadius: cssVar.borderRadius,
    borderStartEndRadius: cssVar.borderRadius,
  },
  /**
   * The comment the URL points at. An outline rather than a fill: the box's own
   * line already carries meaning (yours vs theirs), and the discussion has no
   * fills left to compete with.
   */
  boxAnchored: {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: cssVar.colorInfoBorder,
    outlineOffset: '2px',
  },
  /** Attachments sit under the words with a gap, never woven into them. */
  attachments: {
    paddingBlockStart: '10px',
  },
  /** The composer, wrapped so it reads as one block rather than a loose field. */
  composerBlock: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':focus-within': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    transition: `border-color ${cssVar.motionDurationFast}`,
  },
  deleted: {
    fontStyle: 'italic',
    color: cssVar.colorTextTertiary,
  },
  event: {
    paddingBlock: '2px',
    fontSize: '13px',
    color: cssVar.colorTextSecondary,
  },
  eventDot: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${EVENT_DOT}px`,
    height: `${EVENT_DOT}px`,
    color: cssVar.colorTextTertiary,
  },
  entryAnchored: {
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorInfoBg,
    boxShadow: `0 0 0 6px ${cssVar.colorInfoBg}`,
  },
  feedBody: {
    paddingBlockStart: '4px',
    paddingInlineStart: `${TIMELINE_NODE + NODE_GUTTER}px`,
    fontSize: '14px',
    lineHeight: 1.65,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  meta: {
    flex: 'none',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  /** The timestamp doubles as the permalink: quiet until you reach for it. */
  timeLink: {
    cursor: 'pointer',
    padding: 0,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    color: { 'default': null, ':hover': cssVar.colorText },
    textDecoration: { 'default': null, ':hover': 'underline' },
    transition: `color ${cssVar.motionDurationFast}`,
  },
  panelBody: {
    paddingBlockStart: '6px',
    fontSize: '13px',
    lineHeight: 1.65,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  /**
   * The actions close the note, so they hug its bottom edge. Sitting a full
   * panel padding above it left a band of empty surface under them that read
   * as a rendering mistake.
   */
  panelActions: {
    marginBlockEnd: '-4px',
    paddingBlockStart: '10px',
  },
  panelReply: {
    paddingBlockStart: '10px',
  },
  /**
   * A settled note is closed business. It folds down to one quiet line and,
   * opened again, stays muted — a handled concern should never draw the eye
   * harder than an open one, which a green badge did.
   */
  resolvedSummary: {
    cursor: 'pointer',
    width: '100%',
    padding: 0,
    borderStyle: 'none',
    fontSize: '13px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    textAlign: 'start',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  resolvedThread: {
    color: cssVar.colorTextTertiary,
  },
  /**
   * A name is never a wrap point. In the narrow floating note the header ran
   * out of room and broke a two-character name down the middle of the circle.
   */
  authorName: {
    overflow: 'hidden',
    flex: 'none',
    maxWidth: '180px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  /**
   * A headline is a sentence, not a name: it may wrap, and it must never be
   * cut at the name cap — "Acceptance Builder 提交了…" says nothing.
   */
  headline: {
    minWidth: 0,
  },
  /** Pushed to the end of its line, so the header above may wrap freely. */
  rowActions: {
    flex: 'none',
    marginInlineStart: 'auto',
    opacity: {
      'default': 0,
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover', timelineEntryMarker)]: 1,
    },
    transition: `opacity ${cssVar.motionDurationFast}`,
  },
  nodelessEntry: {
    paddingInlineStart: `${TIMELINE_NODE + NODE_GUTTER}px`,
  },
  timelineEntry: {
    position: 'relative',
    paddingBlock: `${ENTRY_GAP}px`,
  },
  timelineNode: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: `${TIMELINE_NODE}px`,
    height: `${TIMELINE_NODE}px`,
    lineHeight: 0,
  },
});
