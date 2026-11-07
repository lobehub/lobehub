import { Block, Button } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { type CellStatus, conditionColumns, overviewRows, type ReportCase } from '../data';
import { stateLabel, THEME_LABELS } from '../labels';
import { hrefOf } from '../route';

const styles = stylex.create({
  cell: {
    borderRadius: cssVar.borderRadiusXS,
    fontSize: cssVar.fontSizeSM,
    height: 24,
    minWidth: 40,
    textAlign: 'center',
  },
  head: {
    color: cssVar.colorTextTertiary,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 400,
    lineHeight: 1.4,
    textAlign: 'center',
  },
  name: {
    color: cssVar.colorText,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    paddingInlineEnd: 12,
    textDecorationLine: { ':hover': 'underline', 'default': 'none' },
    whiteSpace: 'nowrap',
  },
  rowHead: {
    backgroundColor: cssVar.colorBgContainer,
    fontWeight: 400,
    insetInlineStart: 0,
    position: 'sticky',
    textAlign: 'start',
    zIndex: 1,
  },
  scroll: { overflowX: 'auto', padding: 16 },
  table: { borderCollapse: 'separate', borderSpacing: 4 },
  themeHead: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    color: cssVar.colorTextSecondary,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    paddingBlockEnd: 4,
    textAlign: 'start',
  },
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
    <Block variant="outlined">
      <div {...stylex.props(styles.scroll)}>
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.rowHead)} />
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
              <th {...stylex.props(styles.rowHead)} />
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
                  <Button size="small" type="text" onClick={() => setShowEqual(true)}>
                    另外 {equal.length} 个文件全部相等，展开
                  </Button>
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
    </Block>
  );
};
