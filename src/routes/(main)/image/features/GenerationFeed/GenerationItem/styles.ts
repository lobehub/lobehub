import { createStaticStyles, cx } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // 图片操作按钮的公共样式
  generationActionButton: cx(
    'generation-actions',
    css`
      position: absolute;
      z-index: 10;
      inset-block-start: 8px;
      inset-inline-end: 8px;

      opacity: 0;

      transition: opacity 0.1s ${cssVar.motionEaseInOut};
    `,
  ),

  imageContainer: css`
    position: relative;
    overflow: hidden;
    width: 100%;

    &:hover .generation-actions {
      opacity: 1;
    }
  `,
  loadingContent: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  placeholderContainer: css`
    position: relative;
    overflow: hidden;
    width: 100%;

    &:hover .generation-actions {
      opacity: 1;
    }
  `,

  spinIcon: css`
    color: ${cssVar.colorPrimary};
  `,
}));
