import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  aside: css`
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: baseline;

    font-size: 13px;
  `,
  asideLabel: css`
    color: ${cssVar.colorTextSecondary};
  `,
  asideValue: css`
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  `,
  chip: css`
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 5px;

    font-size: 12.5px;
    font-weight: 500;
    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  container: css`
    overflow: auto;
    flex: 1;
    background: ${cssVar.colorBgContainer};
  `,
  doc: css`
    display: flex;
    flex-direction: column;
    gap: 30px;

    max-width: 920px;
    margin-inline: auto;
    padding-block: 28px 44px;
    padding-inline: 32px;
  `,
  docHead: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    padding-block-end: 18px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  docSubtitle: css`
    font-size: 13.5px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  docTitle: css`
    font-size: 24px;
    font-weight: 600;
    text-wrap: balance;
    letter-spacing: -0.015em;
  `,
  extra: css`
    display: block;
    margin-block-start: 2px;
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
  `,
  hint: css`
    font-size: 11.5px;
    line-height: 1.6;
    color: ${cssVar.colorTextQuaternary};
  `,
  kv: css`
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 9px 18px;
    align-items: baseline;

    margin: 0;

    dt {
      font-size: 12.5px;
      color: ${cssVar.colorTextSecondary};
    }

    dd {
      margin: 0;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  sectionHead: css`
    display: flex;
    gap: 12px;
    align-items: center;

    font-size: 15px;
    font-weight: 600;
  `,
  sectionRule: css`
    flex: 1;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  table: css`
    overflow-x: auto;

    table {
      border-collapse: collapse;

      /* The portal pane is narrow; let the grid keep its column rhythm and
         scroll sideways instead of collapsing cells into one glyph per line. */
      width: 100%;
      min-width: max-content;
      font-size: 13px;
    }

    th {
      padding-block-end: 8px;
      padding-inline: 10px;
      border-block-end: 1px solid ${cssVar.colorBorder};

      font-size: 10.5px;
      font-weight: 500;
      color: ${cssVar.colorTextQuaternary};
      text-align: start;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      white-space: nowrap;
    }

    td {
      max-width: 320px;
      padding-block: 8px;
      padding-inline: 10px;
      border-block-end: 1px solid ${cssVar.colorFillQuaternary};

      vertical-align: baseline;
    }

    tr[data-total] td {
      padding-block-start: 11px;
      border-block-start: 1px solid ${cssVar.colorBorder};
      border-block-end: none;
      font-weight: 600;
    }

    tbody tr:last-child td {
      border-block-end: none;
    }

    tbody tr:not([data-total]):hover td {
      background: ${cssVar.colorFillQuaternary};
    }

    td[data-align='right'],
    th[data-align='right'] {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }

    td[data-align='center'],
    th[data-align='center'] {
      text-align: center;
    }
  `,
}));
