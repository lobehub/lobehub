import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  titleInput: css`
    flex: 1;

    padding-inline: 0;

    font-size: 36px;
    font-weight: 600;
    line-height: 1.3;
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
}));
