import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { type CellStatus, conditionColumns, overviewRows, type ReportCase } from '../data';
import { stateLabel, THEME_LABELS } from '../labels';
import { hrefOf } from '../route';

const styles = stylex.create({
  cell: {
    borderRadius: 4,
    fontSize: 10.5,
    height: 22,
    minWidth: 40,
    textAlign: 'center',
  },
  expand: {
    backgroundColor: 'transparent',
    borderStyle: 'none',
    color: cssVar.colorTextTertiary,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11.5,
    paddingInline: 0,
  },
  head: { color: cssVar.colorTextTertiary, fontSize: 10.5, fontWeight: 500, textAlign: 'center' },
  rowHead: { fontWeight: 400, textAlign: 'start' },
  themeHead: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    color: cssVar.colorTextSecondary,
    fontSize: 11.5,
    fontWeight: 500,
    textAlign: 'start',
  },
  name: {
    color: cssVar.colorText,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 11.5,
    paddingInlineEnd: 12,
    textDecorationLine: { ':hover': 'underline', 'default': 'none' },
    whiteSpace: 'nowrap',
  },
  panel: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    overflowX: 'auto',
    paddingBlock: 12,
    paddingInline: 14,
  },
  table: { borderCollapse: 'separate', borderSpacing: 3 },
});

const cells = stylex.create({
  'difference': { backgroundColor: cssVar.colorError, color: cssVar.colorTextLightSolid },
  'equal': { backgroundColor: cssVar.colorSuccessBg, color: cssVar.colorSuccess },
  'flagged-difference': { backgroundColor: cssVar.colorErrorBg, color: cssVar.colorError },
  'unknown': { backgroundColor: cssVar.colorFillQuaternary, color: cssVar.colorTextQuaternary },
});

const cellText = (status: CellStatus, count: number) =>
  status === 'equal' ? '✓' : status === 'unknown' ? '—' : String(count);

export const OverviewMatrix = ({
  cases,
  conditions,
}: {
  cases: ReportCase[];
  conditions: string[];
}) => {
  const [showEqual, setShowEqual] = useState(false);
  const columns = conditionColumns(conditions);
  const themes = [...new Set(columns.map((column) => column.theme))];
  const { equal, open } = overviewRows(cases, columns);
  const rows = showEqual ? [...open, ...equal] : open;
  return (
    <div {...stylex.props(styles.panel)}>
      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            <th />
            {themes.map((theme) => (
              <th
                colSpan={columns.filter((column) => column.theme === theme).length}
                key={theme}
                {...stylex.props(styles.themeHead)}
              >
                {THEME_LABELS[theme] ?? theme}
              </th>
            ))}
          </tr>
          <tr>
            <th />
            {columns.map((column) => (
              <th key={column.label} title={column.label} {...stylex.props(styles.head)}>
                {column.width}
                <br />
                {stateLabel(column.state, column.variant)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr aria-label={row.file} key={row.file}>
              <th scope="row" {...stylex.props(styles.rowHead)}>
                <a href={hrefOf({ file: row.file, kind: 'file' })} {...stylex.props(styles.name)}>
                  {row.file}
                </a>
              </th>
              {row.matrix.map((cell) => (
                <td
                  data-status={cell.status}
                  key={cell.label}
                  title={cell.label}
                  {...stylex.props(styles.cell, cells[cell.status])}
                >
                  {cellText(cell.status, cell.count)}
                </td>
              ))}
            </tr>
          ))}
          {!showEqual && equal.length > 0 && (
            <tr aria-label={`另外 ${equal.length} 个文件全部相等`}>
              <th scope="row" {...stylex.props(styles.rowHead)}>
                <button
                  type="button"
                  onClick={() => setShowEqual(true)}
                  {...stylex.props(styles.expand)}
                >
                  另外 {equal.length} 个文件全部相等 · 展开
                </button>
              </th>
              {columns.map((column) => (
                <td
                  data-status="equal"
                  key={column.label}
                  {...stylex.props(styles.cell, cells.equal)}
                >
                  ✓
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
