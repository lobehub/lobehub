import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // 内容容器
  contentContainer: css`
    position: relative;
    overflow: hidden;
  `,

  // 主容器
  mainContainer: css`
    position: relative;
    overflow: hidden;
    background: ${cssVar.colorBgContainer};
  `,
}));
