import { createStaticStyles } from 'antd-style';
import { memo, useLayoutEffect, useRef } from 'react';

import type { CellModel, CellStyle, SheetModel } from './model';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: auto;
    flex: 1;

    /* The grid replays the workbook's own colors, which were authored against
       white paper — theme-following surfaces would put the file's font colors
       on a dark ground. */
    color: #1a1a1a;
    background: #fff;

    table {
      table-layout: fixed;
      border-spacing: 0;
      border-collapse: separate;
    }

    td {
      overflow: hidden;

      /* Frozen rows are sticky; an unfilled cell must still paint over the
         rows scrolling underneath it. Cell fills override this inline. */
      padding-block: 1px;
      padding-inline: 4px;
      border-block-end: 1px solid #e0e2e6;
      border-inline-end: 1px solid #e0e2e6;

      font-size: 13px;
      line-height: 1.35;
      vertical-align: bottom;

      background: #fff;
    }
  `,
  corner: css`
    z-index: 5;
    inset-block-start: 0;
    inset-inline-start: 0;
  `,
  frozen: css`
    td,
    th {
      position: sticky;
      z-index: 3;
    }
  `,
  frozenLast: css`
    td,
    th {
      box-shadow: 0 1px 0 0 #9aa4b2;
    }
  `,
  frozenColumnLast: css`
    box-shadow: 1px 0 0 0 #9aa4b2;
  `,
  gutter: css`
    position: sticky;

    border-block-end: 1px solid #e0e2e6;
    border-inline-end: 1px solid #e0e2e6;

    font-size: 11px;
    font-weight: 400;
    color: #6a7280;
    text-align: center;
    white-space: nowrap;

    background: #f2f3f5;
  `,
  headCell: css`
    z-index: 3;
    inset-block-start: 0;
    height: 22px;
  `,
  rowHead: css`
    z-index: 2;
    inset-inline-start: 0;
    width: 46px;
  `,
}));

const GUTTER_WIDTH = 46;

const columnName = (index: number) => {
  let name = '';
  let value = index;
  while (value > 0) {
    const rest = (value - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    value = (value - rest - 1) / 26;
  }
  return name;
};

const pointToPixel = (value: number) => Math.round((value * 4) / 3);

const BORDER_EDGE = { b: 'blockEnd', l: 'inlineStart', r: 'inlineEnd', t: 'blockStart' } as const;

const toCssStyle = (style: CellStyle): Record<string, string> => {
  const css: Record<string, string> = {
    textAlign: style.h ?? 'left',
    verticalAlign: style.v === 'middle' ? 'middle' : style.v === 'top' ? 'top' : 'bottom',
    whiteSpace: style.w ? 'pre-wrap' : 'nowrap',
  };
  if (style.bg) css.background = style.bg;
  if (style.fc) css.color = style.fc;
  if (style.b) css.fontWeight = '600';
  if (style.i) css.fontStyle = 'italic';
  if (style.fs) css.fontSize = `${pointToPixel(style.fs)}px`;
  if (style.ff) css.fontFamily = `"${style.ff}", var(--font-family, sans-serif)`;
  for (const [key, side] of Object.entries(style.bd ?? {})) {
    const edge = BORDER_EDGE[key as keyof typeof BORDER_EDGE];
    css[`border${edge[0].toUpperCase()}${edge.slice(1)}`] = `${side[0]}px solid ${side[1]}`;
  }
  return css;
};

const stickyColumnStyle = (
  offset: number,
  frozenRow: boolean,
): Record<string, string | number> => ({
  insetInlineStart: offset,
  position: 'sticky',
  zIndex: frozenRow ? 4 : 2,
});

const GridCell = memo<{
  cell: CellModel;
  frozenColOffset?: number;
  frozenRow: boolean;
  lastFrozenCol: boolean;
}>(({ cell, frozenColOffset, frozenRow, lastFrozenCol }) => (
  <td
    className={lastFrozenCol ? styles.frozenColumnLast : undefined}
    colSpan={cell.cs}
    rowSpan={cell.rs}
    style={{
      ...toCssStyle(cell.s),
      ...(frozenColOffset === undefined ? {} : stickyColumnStyle(frozenColOffset, frozenRow)),
    }}
  >
    {cell.t}
  </td>
));

GridCell.displayName = 'GridCell';

interface SheetGridProps {
  sheet: SheetModel;
}

const SheetGrid = memo<SheetGridProps>(({ sheet }) => {
  const container = useRef<HTMLDivElement>(null);
  const frozenRows = sheet.frozen?.rows ?? 0;
  const frozenCols = sheet.frozen?.cols ?? 0;
  const frozenColOffsets = sheet.cols.reduce<number[]>((offsets, _width, index) => {
    if (index < frozenCols)
      offsets.push((offsets.at(-1) ?? GUTTER_WIDTH) + (index === 0 ? 0 : sheet.cols[index - 1]));
    return offsets;
  }, []);

  // Sticky rows need their own resolved offsets; row heights are only known
  // once the browser has laid the table out.
  useLayoutEffect(() => {
    const root = container.current;
    if (!root || frozenRows === 0) return;
    const head = root.querySelector('thead th');
    if (!head) return;
    let offset = head.getBoundingClientRect().height;
    for (const row of root.querySelectorAll<HTMLTableRowElement>('tbody tr[data-frozen]')) {
      for (const child of row.children)
        (child as HTMLElement).style.insetBlockStart = `${offset}px`;
      offset += row.getBoundingClientRect().height;
    }
  }, [sheet, frozenRows]);

  return (
    <div className={styles.container} ref={container}>
      <table>
        <colgroup>
          <col style={{ width: GUTTER_WIDTH }} />
          {sheet.cols.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={`${styles.gutter} ${styles.corner} ${styles.headCell}`} />
            {sheet.cols.map((_, index) => (
              <th
                key={index}
                className={[
                  styles.gutter,
                  styles.headCell,
                  index === frozenCols - 1 && styles.frozenColumnLast,
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={
                  index >= frozenCols
                    ? undefined
                    : { insetInlineStart: frozenColOffsets[index], zIndex: 4 }
                }
              >
                {columnName(index + 1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row) => {
            const frozen = row.r <= frozenRows;
            const className = [
              frozen && styles.frozen,
              frozen && row.r === frozenRows && styles.frozenLast,
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <tr
                className={className}
                data-frozen={frozen ? '' : undefined}
                key={row.r}
                style={row.h ? { height: pointToPixel(row.h) } : undefined}
              >
                <th className={`${styles.gutter} ${styles.rowHead}`}>{row.r}</th>
                {row.cells.map((cell) => (
                  <GridCell
                    cell={cell}
                    frozenRow={frozen}
                    key={cell.c}
                    lastFrozenCol={cell.c === frozenCols}
                    frozenColOffset={
                      cell.c <= frozenCols ? frozenColOffsets[cell.c - 1] : undefined
                    }
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

SheetGrid.displayName = 'SheetGrid';

export default SheetGrid;
