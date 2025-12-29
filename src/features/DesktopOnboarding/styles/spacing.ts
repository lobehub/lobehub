import { createStaticStyles } from 'antd-style';

// 间距相关的通用样式
export const spacingStyles = createStaticStyles(({ cssVar, css }) => ({
  // Gap (for flex/grid)
  gap: css`
    gap: ${cssVar.margin};
  `,

  gapLG: css`
    gap: ${cssVar.marginLG};
  `,

  gapSM: css`
    gap: ${cssVar.marginSM};
  `,

  // Margin
  marginBottom: css`
    margin-block-end: ${cssVar.margin};
  `,

  marginBottomLG: css`
    margin-block-end: ${cssVar.marginLG};
  `,

  marginBottomSM: css`
    margin-block-end: ${cssVar.marginSM};
  `,

  marginTop: css`
    margin-block-start: ${cssVar.margin};
  `,

  marginTopLG: css`
    margin-block-start: ${cssVar.marginLG};
  `,

  marginTopSM: css`
    margin-block-start: ${cssVar.marginSM};
  `,

  // Padding
  padding: css`
    padding: ${cssVar.padding};
  `,

  paddingLG: css`
    padding: ${cssVar.paddingLG};
  `,

  paddingSM: css`
    padding: ${cssVar.paddingSM};
  `,
}));
