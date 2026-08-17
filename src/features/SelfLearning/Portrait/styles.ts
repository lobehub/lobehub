import { createStaticStyles, cssVar } from 'antd-style';

/**
 * 整页只有一种强调色，只标一件事：它做错的地方。
 * 「对 / 已养成 / 用上了」是默认态，不发信号；成长曲线用 success 色，和错点分开。
 */
export const portraitStyles = createStaticStyles(({ css }) => ({
  accent: css`
    color: ${cssVar.colorWarning} !important;
  `,
  bar: css`
    overflow: hidden;
    display: flex;
    flex: none;

    width: 120px;
    height: 5px;
    border-radius: 3px;

    background: ${cssVar.colorFillSecondary};
  `,
  dot: css`
    display: inline-block;

    box-sizing: border-box;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  `,
  dotBad: css`
    background: ${cssVar.colorWarning};
  `,
  dotNone: css`
    border: 1px solid ${cssVar.colorBorder};
    background: transparent;
  `,
  dotOk: css`
    background: ${cssVar.colorTextQuaternary};
  `,
  groupHead: css`
    padding-block: 8px;
    padding-inline: 14px;
    border: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font: inherit;

    background: ${cssVar.colorFillQuaternary};
  `,
  row: css`
    padding-block: 10px;
    padding-inline: 14px;
    border: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font: inherit;

    &:last-child {
      border-block-end: none;
    }

    .teach {
      opacity: 0;
      transition: opacity 0.15s;
    }

    &:hover,
    &:focus-within {
      background: ${cssVar.colorFillQuaternary};

      .teach {
        opacity: 1;
      }
    }
  `,
  segBad: css`
    background: ${cssVar.colorWarning};
  `,
  segOk: css`
    background: ${cssVar.colorTextQuaternary};
  `,
  segShaky: css`
    opacity: 0.55;
    background: ${cssVar.colorWarning};
  `,
  sentence: css`
    font-size: 22px;
    font-weight: 700;
    line-height: 1.4;
    text-wrap: balance;
  `,
}));
