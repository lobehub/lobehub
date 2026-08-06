import { createStaticStyles } from 'antd-style';

/** Shared responsive layout for Aico org / platform / wallet panels. */
export const aicoPanelStyles = createStaticStyles(({ css, cssVar }) => ({
  formRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;

    width: 100%;
    min-width: 0;

    .ant-form-item {
      margin-block-end: 12px;
    }

    @media (width <= 768px) {
      flex-direction: column;

      .ant-form-item {
        width: 100% !important;
        min-width: 0 !important;
        margin-inline-end: 0 !important;
      }
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
    gap: 12px;
  `,
  headerRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-width: 0;

    @media (width <= 768px) {
      flex-direction: column;
      align-items: stretch;
    }
  `,
  orgSelect: css`
    min-width: 240px;

    @media (width <= 768px) {
      width: 100%;
      min-width: 0;
    }
  `,
  page: css`
    width: 100%;
    min-width: 0;
    max-width: 1100px;
  `,
  section: css`
    min-width: 0;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    @media (width <= 768px) {
      padding: 12px;
    }
  `,
  sourceGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: 12px;
  `,
  tableScroll: css`
    overflow-x: auto;
    width: 100%;
    min-width: 0;

    -webkit-overflow-scrolling: touch;
  `,
  tabs: css`
    overflow-x: auto;
    width: 100%;
    min-width: 0;

    -webkit-overflow-scrolling: touch;

    /* Keep tab labels on one scrollable row on narrow screens */
    [role='tablist'] {
      flex-wrap: nowrap;
      width: max-content;
      min-width: 100%;
    }
  `,
}));

export const AICO_TABLE_SCROLL = { x: 'max-content' as const };
