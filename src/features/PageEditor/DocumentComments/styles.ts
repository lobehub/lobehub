import { createStaticStyles, cssVar } from 'antd-style';

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
    padding-block: 20px 12px;
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
  empty: css`
    min-height: 120px;
  `,
  header: css`
    min-height: 32px;
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
