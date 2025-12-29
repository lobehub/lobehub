import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Header 容器
  headerContainer: css`
    border-block-end: 1px solid var(--header-border-color, ${cssVar.colorBorderSecondary});
  `,
}));
