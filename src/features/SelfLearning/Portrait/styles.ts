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

    width: 100%;
    height: 5px;
    border-radius: 3px;

    background: ${cssVar.colorFillSecondary};
  `,
  profileCounts: css`
    min-width: 0;
    text-align: end;
    white-space: nowrap;
  `,
  profileKey: css`
    flex: none;
    width: 32px;
    font-family: ${cssVar.fontFamilyCode};
    white-space: nowrap;
  `,
  profileProgress: css`
    width: 100%;
    min-width: 120px;
  `,
  profileRow: css`
    display: grid;
    grid-template-columns: minmax(220px, 1.15fr) minmax(180px, 1fr) 84px minmax(220px, auto);
    gap: 20px;
    align-items: center;

    padding-block: 14px;
    padding-inline: 18px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    @media (width <= 1100px) {
      grid-template-columns: minmax(200px, 1fr) minmax(140px, 1fr) 84px;

      & > :last-child {
        grid-column: 2 / -1;
        text-align: start;
      }
    }
  `,
  profileTitle: css`
    padding-block: 14px 10px;
    padding-inline: 18px;
    font-size: 12px;
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
  previewTarget: css`
    cursor: pointer;
    text-align: start;

    &:focus-visible {
      border-radius: 4px;
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }
  `,
  viewAll: css`
    font-size: 12.5px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    &:hover {
      color: ${cssVar.colorText};
    }
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
