import { createStaticStyles, css, cx } from 'antd-style';

export const lineEllipsis = (line: number) =>
  cx(css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: ${line};

    text-overflow: ellipsis;
  `);

export const oneLineEllipsis = lineEllipsis(1);

/**
 * Highlight underline effect using gradient background
 * - primary: default blue highlight
 * - info: info blue highlight
 * - warning: warning yellow highlight
 * - gold: gold highlight (for page-agent etc.)
 */
export const highlightTextStyles = createStaticStyles(({ css, cssVar }) => ({
  gold: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    background: linear-gradient(to top, ${cssVar.gold4} 40%, transparent 40%);
  `,
  info: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    background: linear-gradient(to top, ${cssVar.colorInfoBg} 40%, transparent 40%);
  `,
  primary: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    background: linear-gradient(to top, ${cssVar.colorPrimaryBgHover} 40%, transparent 40%);
  `,
  warning: css`
    padding-block-end: 1px;
    color: ${cssVar.colorText};
    background: linear-gradient(to top, ${cssVar.colorWarningBg} 40%, transparent 40%);
  `,
}));
