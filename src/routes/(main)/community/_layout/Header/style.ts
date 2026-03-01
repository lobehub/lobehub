import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Header 容器
  headerContainer: css`
    position: relative;
    z-index: 10;
    border-block-end: 1px solid var(--header-border-color, ${cssVar.colorBorderSecondary});
    background: var(--header-bg, ${cssVar.colorBgContainer});
  `,
}));
