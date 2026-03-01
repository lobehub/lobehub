import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // 绝对定位容器，占满父容器
  absoluteContainer: css`
    position: absolute;
    inset: 0;
  `,

  // 内容区域 - 深色模式
  contentDark: css`
    overflow: hidden;
    background: linear-gradient(
      to bottom,
      ${cssVar.colorBgContainer},
      var(--content-bg-secondary, ${cssVar.colorBgContainer})
    );
  `,

  // 内容区域 - 浅色模式
  contentLight: css`
    overflow: hidden;
    background: var(--content-bg-secondary, ${cssVar.colorBgContainer});
  `,
}));
