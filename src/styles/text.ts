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
 * Inspector text style for builtin tool inspectors
 * Combines oneLineEllipsis with secondary text color
 */
export const inspectorTextStyles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: flex;
    align-items: center;

    min-width: 0;

    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/**
 * Highlight underline effect using gradient background
 * - primary: default blue highlight
 * - info: info blue highlight
 * - warning: warning yellow highlight
 * - gold: gold highlight (for page-agent etc.)
 */
export const highlightTextStyles = createStaticStyles(({ css, cssVar }) => {
  const highlightBase = (highlightColor: string) => css`
    overflow: hidden;

    min-width: 0;
    margin-inline-start: 4px;
    padding-block-end: 1px;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;

    background: linear-gradient(to top, ${highlightColor} 40%, transparent 40%);
  `;

  return {
    gold: highlightBase(cssVar.gold4),
    info: highlightBase(cssVar.colorInfoBg),
    primary: highlightBase(cssVar.colorPrimaryBgHover),
    warning: highlightBase(cssVar.colorWarningBg),
  };
});
