import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // 主容器 - 非 PWA 模式（无顶部边框）
  mainContainer: css`
    position: relative;
  `,

  // 主容器 - PWA 模式（带顶部边框）
  mainContainerPWA: css`
    position: relative;
    border-block-start: 1px solid ${cssVar.colorBorder};
  `,
}));
