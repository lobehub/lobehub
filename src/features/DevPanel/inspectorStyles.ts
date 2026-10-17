import { createStaticStyles, cssVar } from '@lobehub/ui';

export const inspectorStyles = createStaticStyles(({ css }) => ({
  listCount: css`
    flex-shrink: 0;

    min-width: 24px;
    padding-inline: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusXS};

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  listIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  listItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    height: 32px;
    padding-inline: 12px;
    border: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    text-align: start;

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  listItemActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  list: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
    padding-block: 4px;
  `,
  listName: css`
    overflow: hidden;
    flex: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  sidePane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  detailField: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  detailFields: css`
    overflow: auto;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  detailLabel: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  detailType: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextTertiary};
  `,
  detailValue: css`
    overflow: auto;

    min-height: 28px;
    max-height: 180px;
    margin: 0;
    padding-block: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.6;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  detailsPane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;

    @media (width <= 900px) {
      display: none;
    }
  `,
  empty: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    min-height: 0;
    padding: 24px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  error: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;

    min-height: 0;
    padding: 24px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorError};
    text-align: center;
  `,
  listItemNested: css`
    height: 28px;
    padding-inline-start: 34px;
  `,
  rowActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  table: css`
    table-layout: fixed;
    border-spacing: 0;
    border-collapse: separate;

    th,
    td {
      overflow: hidden;

      height: 32px;
      padding-inline: 8px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

      font-family: ${cssVar.fontFamilyCode};
      font-size: ${cssVar.fontSizeSM};
      color: ${cssVar.colorTextSecondary};
      text-align: start;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;

      font-family: ${cssVar.fontFamily};
      font-weight: 600;
      color: ${cssVar.colorText};

      background: ${cssVar.colorBgContainer};
    }

    th:last-child,
    td:last-child {
      border-inline-end: 0;
    }

    tbody tr {
      cursor: pointer;
      outline: none;
    }

    tbody tr:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    tbody tr:focus-visible {
      box-shadow: inset 0 0 0 2px ${cssVar.colorPrimary};
    }
  `,
  tableEmpty: css`
    position: absolute;
    inset-block: 32px 0;
    inset-inline: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 24px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  tableName: css`
    overflow: hidden;
    flex-shrink: 1;

    min-width: 100px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tablePane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  tableScroll: css`
    position: relative;
    overflow: auto;
    flex: 1;
    min-height: 0;
  `,
  toolbarMeta: css`
    flex-shrink: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    @media (width <= 1100px) {
      display: none;
    }
  `,
  toolbarSearch: css`
    min-width: 120px;
    max-width: 300px;
  `,
  workspace: css`
    overflow: hidden;
    display: grid;
    grid-template-columns: 220px minmax(360px, 1fr) 300px;
    flex: 1;

    min-height: 0;

    @media (width <= 1200px) {
      grid-template-columns: 190px minmax(360px, 1fr) 260px;
    }

    @media (width <= 900px) {
      grid-template-columns: 170px minmax(0, 1fr);
    }

    @media (width <= 560px) {
      grid-template-columns: 140px minmax(0, 1fr);
    }
  `,
}));
