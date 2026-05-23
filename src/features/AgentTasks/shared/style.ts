import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  titleInput: css`
    &.ant-input {
      resize: none;

      flex: 1;

      min-height: auto;
      padding: 0;

      font-size: 24px;
      font-weight: 600;
      line-height: 1.3;
    }
  `,

  breadcrumb: css`
    overflow: hidden;
    min-width: 0;

    ol {
      flex-wrap: nowrap;
      align-items: center;
      min-width: 0;
    }

    li {
      overflow: hidden;
      display: flex;
      flex-shrink: 1;
      align-items: center;

      min-width: 0;
    }

    li.ant-breadcrumb-separator {
      overflow: visible;
      flex-shrink: 0;
      min-width: auto;
      margin-inline: 2px;
    }

    .ant-breadcrumb-link,
    .ant-breadcrumb-link > a {
      overflow: hidden;
      display: flex;
      align-items: center;

      min-width: 0;
      padding-block: 2px;
      padding-inline: 6px;
      border-radius: ${cssVar.borderRadius};
    }
  `,

  subtaskTree: css`
    .ant-tree-node-content-wrapper {
      cursor: default;

      overflow: hidden;
      display: flex;
      flex: 1;
      gap: 4px;
      align-items: center;

      min-width: 0;
      min-height: 36px;

      color: ${cssVar.colorTextSecondary};
    }

    .ant-tree-title {
      overflow: hidden;
      flex: 1;
      min-width: 0;
    }

    .ant-tree-switcher {
      margin-inline-end: 0;
      color: ${cssVar.colorTextDescription};
    }
  `,

  activityAvatar: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 50%;

    color: ${cssVar.colorTextQuaternary};

    background: ${cssVar.colorFillTertiary};
  `,

  commentCard: css`
    position: relative;

    .comment-actions {
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    &:hover .comment-actions,
    &:focus-within .comment-actions {
      opacity: 1;
    }
  `,

  commentActions: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 8px;
  `,

  agentAuthorName: css`
    cursor: pointer;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,

  commentInputCard: css`
    padding: 8px;
    border: 1px solid transparent;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillTertiary};

    transition:
      background 0.15s ease,
      border-color 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }

    &:focus-within {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));
