import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actionSlot: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    margin-block-start: auto;
  `,
  cell: css`
    display: flex;
    flex-direction: column;
    gap: 16px;

    min-height: 280px;
    padding: 32px;

    background: ${cssVar.colorBgContainer};

    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    transition-duration: 160ms;
    transition-property: background-color;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    @media (width <= 760px) {
      min-height: 220px;
      padding: 24px;
    }
  `,
  cellBody: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
  `,
  cellMeta: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  cellTitle: css`
    margin: 0;
    font-size: ${cssVar.fontSizeXL};
    font-weight: ${cssVar.fontWeightStrong};
    line-height: 1.3;
  `,
  command: css`
    overflow: hidden;

    min-width: 0;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusSM};

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  content: css`
    width: min(100%, 1040px);
    margin-block: 0;
    margin-inline: auto;
    padding-block: 32px 96px;
    padding-inline: 24px;

    @media (width <= 760px) {
      padding-block: 16px 64px;
      padding-inline: 16px;
    }
  `,
  grid: css`
    overflow: hidden;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBorder};

    @media (width <= 760px) {
      grid-template-columns: 1fr;
    }
  `,
  header: css`
    display: flex;
    grid-column: 1 / -1;
    flex-direction: column;
    gap: 16px;
    justify-content: end;

    min-height: 168px;
    padding: 32px;

    background: ${cssVar.colorBgContainer};

    @media (width <= 760px) {
      min-height: 132px;
      padding: 24px;
    }
  `,
  headerTop: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  kicker: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,
  index: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
  `,
  page: css`
    overflow-y: auto;
    height: 100%;
    min-height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
  pageTitle: css`
    margin: 0;

    font-size: ${cssVar.fontSizeHeading2};
    font-weight: ${cssVar.fontWeightStrong};
    line-height: 1.2;
    text-wrap: balance;
  `,
}));
