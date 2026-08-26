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
  composer: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};

    transition:
      border-color ${cssVar.motionDurationFast},
      background ${cssVar.motionDurationFast},
      box-shadow ${cssVar.motionDurationFast};

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorBgContainer};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
  `,
  deleted: css`
    font-style: italic;
    color: ${cssVar.colorTextTertiary};
  `,
  editArea: css`
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
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
