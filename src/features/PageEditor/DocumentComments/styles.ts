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

export const styles = createStaticStyles(({ css }) => ({
  actions: css`
    margin-inline-start: 40px;
    padding-block-start: 8px;
    color: ${cssVar.colorTextTertiary};
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
  commentContent: css`
    /* Published comments render images as left-aligned thumbnails: the
       renderer inlines the stored (natural) width, which would otherwise span
       the whole column. */
    & figure:has(> img) {
      margin-block: 8px;
      text-align: start;
    }

    & img {
      width: auto !important;
      max-width: 100% !important;
      height: auto !important;
      max-height: ${COMMENT_CONTENT_IMAGE_MAX_HEIGHT}px;
    }
  `,
  commentEditor: css`
    min-width: 0;

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
      width: auto !important;
      max-width: 100% !important;
      height: auto !important;
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
