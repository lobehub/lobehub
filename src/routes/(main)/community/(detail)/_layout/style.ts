import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  // 内容容器
  contentContainer: css`
    min-height: 100%;
  `,

  // 主容器
  mainContainer: css`
    overflow-y: auto;
  `,

  // 占位符
  spacer: css`
    flex: 1;
  `,
}));
