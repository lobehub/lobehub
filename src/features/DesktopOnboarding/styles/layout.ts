import { createStaticStyles } from 'antd-style';

// 布局相关的通用样式
export const layoutStyles = createStaticStyles(({ css }) => ({
  // 绝对定位容器
  absolute: css`
    position: absolute;
    inset-block: 0 0;
    inset-inline: 0 0;
  `,

  // 居中容器 - 水平垂直居中的 Flex 容器
  centered: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    height: 100%;
  `,

  // 内容布局
  contentSection: css`
    width: 100%;
    max-width: 1152px;
    min-height: 460px;
    margin-block: 0;
    margin-inline: auto;
    padding: 24px;

    text-align: center;
  `,

  // 固定底部容器
  fixedBottom: css`
    position: fixed;
    inset-block-end: 0;
    inset-inline: 0 0;
  `,

  // Flex 列布局
  flexColumn: css`
    display: flex;
    flex-direction: column;
  `,

  // Flex 行布局
  flexRow: css`
    display: flex;
    flex-direction: row;
    align-items: center;
  `,

  // 全屏容器 - 用于需要占满整个视口的场景
  fullScreen: css`
    position: fixed;
    z-index: 10;
    inset-block: 0 0;
    inset-inline: 0 0;

    overflow: hidden;

    width: 100vw;
    height: 100vh;
  `,

  // 最大宽度容器
  maxWidthContainer: css`
    width: 100%;
    max-width: 1024px;
    margin-block: 0;
    margin-inline: auto;
  `,

  // 相对定位容器
  relative: css`
    position: relative;
    height: 100%;
  `,

  // 空间分布
  spaceBetween: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
}));
