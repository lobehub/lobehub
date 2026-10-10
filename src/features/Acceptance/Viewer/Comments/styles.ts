import { createStaticStyles, cssVar } from 'antd-style';

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

export const styles = createStaticStyles(({ css }) => ({
  body: css`
    /* A one-line remark in a header-topped box read as a sliver; GitHub's
       comment bodies always have room to breathe under the author line. */
    min-height: 80px;
    padding-block: 12px;
    padding-inline: 14px;

    font-size: 14px;
    line-height: 1.7;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  /** A discussion message: header strip, then the words. */
  box: css`
    position: relative;

    flex: 1;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
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
  boxSelf: css`
    border-color: ${SELF_BORDER};
  `,
  /**
   * The author line, over the words. No fill and no divider: a strip of tinted
   * surface with a rule under it framed every remark like a table row. The
   * padding stays, so the line still reads as its own band.
   */
  boxHeader: css`
    padding-block: 8px;
    padding-inline: 14px;
    border-start-start-radius: ${cssVar.borderRadius};
    border-start-end-radius: ${cssVar.borderRadius};
  `,
  /**
   * The comment the URL points at. An outline rather than a fill: the box's own
   * line already carries meaning (yours vs theirs), and the discussion has no
   * fills left to compete with.
   */
  boxAnchored: css`
    outline: 2px solid ${cssVar.colorInfoBorder};
    outline-offset: 2px;
  `,
  /** Attachments sit under the words with a gap, never woven into them. */
  attachments: css`
    padding-block-start: 10px;
  `,
  /** The composer, wrapped so it reads as one block rather than a loose field. */
  composerBlock: css`
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: border-color ${cssVar.motionDurationFast};

    &:focus-within {
      border-color: ${cssVar.colorBorder};
    }
  `,
  deleted: css`
    font-style: italic;
    color: ${cssVar.colorTextTertiary};
  `,
  event: css`
    padding-block: 2px;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  eventDot: css`
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: ${EVENT_DOT}px;
    height: ${EVENT_DOT}px;

    color: ${cssVar.colorTextTertiary};
  `,
  entryAnchored: css`
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorInfoBg};
    box-shadow: 0 0 0 6px ${cssVar.colorInfoBg};
  `,
  feedBody: css`
    padding-block-start: 4px;
    padding-inline-start: ${TIMELINE_NODE + NODE_GUTTER}px;

    font-size: 14px;
    line-height: 1.65;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  meta: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  /** The timestamp doubles as the permalink: quiet until you reach for it. */
  timeLink: css`
    cursor: pointer;

    padding: 0;
    border: none;

    background: none;

    transition: color ${cssVar.motionDurationFast};

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }
  `,
  panelBody: css`
    padding-block-start: 6px;

    font-size: 13px;
    line-height: 1.65;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  /**
   * The actions close the note, so they hug its bottom edge. Sitting a full
   * panel padding above it left a band of empty surface under them that read
   * as a rendering mistake.
   */
  panelActions: css`
    margin-block-end: -4px;
    padding-block-start: 10px;
  `,
  panelReply: css`
    padding-block-start: 10px;
  `,
  /**
   * A settled note is closed business. It folds down to one quiet line and,
   * opened again, stays muted — a handled concern should never draw the eye
   * harder than an open one, which a green badge did.
   */
  resolvedSummary: css`
    cursor: pointer;

    width: 100%;
    padding: 0;
    border: none;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
    text-align: start;

    background: none;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  resolvedThread: css`
    color: ${cssVar.colorTextTertiary};
  `,
  /**
   * A name is never a wrap point. In the narrow floating note the header ran
   * out of room and broke a two-character name down the middle of the circle.
   */
  authorName: css`
    overflow: hidden;
    flex: none;

    max-width: 180px;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  /**
   * A headline is a sentence, not a name: it may wrap, and it must never be
   * cut at the name cap — "Acceptance Builder 提交了…" says nothing.
   */
  headline: css`
    min-width: 0;
  `,
  /** Pushed to the end of its line, so the header above may wrap freely. */
  rowActions: css`
    flex: none;
    margin-inline-start: auto;
    opacity: 0;
    transition: opacity ${cssVar.motionDurationFast};

    @media (hover: none) {
      opacity: 1;
    }
  `,
  nodelessEntry: css`
    padding-inline-start: ${TIMELINE_NODE + NODE_GUTTER}px;
  `,
  timelineEntry: css`
    position: relative;
    padding-block: ${ENTRY_GAP}px;

    &:hover [data-comment-actions] {
      opacity: 1;
    }
  `,
  timelineNode: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: ${TIMELINE_NODE}px;
    height: ${TIMELINE_NODE}px;

    line-height: 0;
  `,
}));
