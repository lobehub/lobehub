import { createStaticStyles, cx, keyframes } from 'antd-style';

const shimmer = keyframes`
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
`;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Common styles for image action buttons
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

  placeholderContainer: css`
    position: relative;
    overflow: hidden;
    width: 100%;

    &:hover .generation-actions {
      opacity: 1;
    }
  `,

  placeholderContainerLoading: css`
    &::before {
      content: '';

      position: absolute;
      z-index: 1;
      inset: 0;

      background: ${cssVar.colorFillSecondary};

      animation: ${shimmer} 2s linear infinite;
    }
  `,

  spinIcon: css`
    color: ${cssVar.colorPrimary};
  `,
}));
