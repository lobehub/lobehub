import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  titleInput: css`
    &.ant-input {
      resize: none;

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

  /**
   * One line of the activity timeline. The rail is drawn per line so a run of
   * lines joins up; the first and last line of a run only draw their inner
   * half, so the rail starts and ends at a mark.
   */
  activityLine: css`
    position: relative;

    /*
     * Inset so the 16px mark is centred under the 24px avatar inside a comment
     * card (8px card padding + 12px to the avatar's centre): the rail and the
     * faces in the cards sit on one vertical line, the cards just run wider.
     */
    padding-block: 5px;
    padding-inline-start: 12px;

    &::before {
      content: '';

      position: absolute;
      inset-block: 0;
      inset-inline-start: 19.5px;

      width: 1px;

      background: ${cssVar.colorBorderSecondary};
    }

    &:first-child::before {
      inset-block-start: 50%;
    }

    &:last-child::before {
      inset-block-end: 50%;
    }

    &:only-child::before {
      display: none;
    }
  `,

  /** The 16px mark on the rail: a type icon or a face. Opaque so it covers the rail. */
  activityMark: css`
    position: relative;
    z-index: 1;

    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;
    border-radius: 50%;

    background: ${cssVar.colorBgContainer};
  `,

  /** A run of adjacent lines; cancels the feed's card gap so they sit tight. */
  activityTimeline: css`
    margin-block: -4px;
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
    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,

  commentInputCard: css`
    padding-block: 4px;
    padding-inline: 8px;
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
