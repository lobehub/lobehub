import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Parent bar
  parentBar: css`
    padding-block: 6px;
  `,

  titleInput: css`
    flex: 1;

    padding-inline: 0;

    font-size: 36px;
    font-weight: 600;
    line-height: 1.3;
  `,

  // Subtasks
  subtaskHeader: css`
    cursor: pointer;
    padding-block: 6px;
  `,
  subtaskTree: css`
    .ant-tree-node-content-wrapper {
      overflow: hidden;
      display: flex;
      gap: 4px;
      align-items: center;

      min-height: 36px;
      padding-block: 2px;

      color: ${cssVar.colorTextSecondary};
    }

    .ant-tree-switcher {
      margin-inline-end: 0;
      color: ${cssVar.colorTextDescription};
    }
  `,
  treeRow: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    min-height: 36px;
    padding-block: 6px;
    border-radius: 6px;

    transition: background 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,

  // Activities
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
  commentBox: css`
    margin-block-start: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    transition: border-color 0.2s ${cssVar.motionEaseInOut};

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  commentInput: css`
    resize: none !important;
    padding-block: 12px !important;
    padding-inline: 14px !important;
  `,
  commentActions: css`
    display: flex;
    justify-content: flex-end;
    padding-block: 4px 8px;
    padding-inline: 10px;
  `,
}));
