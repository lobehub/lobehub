import * as stylex from '@stylexjs/stylex';
import { memo, useLayoutEffect, useRef } from 'react';

import { sx } from '@/styles/sx';

import type { CellModel, CellStyle, SheetModel } from './model';

const styles = stylex.create({
  container: {
    overflow: 'auto',
    flex: '1',
    color: '#1a1a1a',
    backgroundColor: '#fff',
    backgroundImage: 'none',
  },
  table: { tableLayout: 'fixed', borderSpacing: 0, borderCollapse: 'separate' },
  cell: {
    overflow: 'hidden',
    paddingBlock: '1px',
    paddingInline: '4px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: '#e0e2e6',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: '#e0e2e6',
    fontSize: '13px',
    lineHeight: 1.35,
    verticalAlign: 'bottom',
    backgroundColor: '#fff',
    backgroundImage: 'none',
  },
  corner: { zIndex: 5, insetBlockStart: 0, insetInlineStart: 0 },
  frozenCell: { position: 'sticky', zIndex: 3 },
  frozenLastCell: { boxShadow: '0 1px 0 0 #9aa4b2' },
  frozenColumnLast: { boxShadow: '1px 0 0 0 #9aa4b2' },
  gutter: {
    position: 'sticky',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: '#e0e2e6',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: '#e0e2e6',
    fontSize: '11px',
    fontWeight: 400,
    color: '#6a7280',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    backgroundColor: '#f2f3f5',
    backgroundImage: 'none',
  },
  headCell: { zIndex: 3, insetBlockStart: 0, height: '22px' },
  rowHead: { zIndex: 2, insetInlineStart: 0, width: '46px' },
});

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
  lastFrozenRow: boolean;
}>(({ cell, frozenColOffset, frozenRow, lastFrozenCol, lastFrozenRow }) => (
  <td
    {...sx(
      [
        styles.cell,
        frozenRow && styles.frozenCell,
        lastFrozenCol && styles.frozenColumnLast,
        lastFrozenRow && styles.frozenLastCell,
      ],
      undefined,
      {
        ...toCssStyle(cell.s),
        ...(frozenColOffset === undefined ? {} : stickyColumnStyle(frozenColOffset, frozenRow)),
      },
    )}
    colSpan={cell.cs}
    rowSpan={cell.rs}
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
    <div {...stylex.props(styles.container)} ref={container}>
      <table {...stylex.props(styles.table)}>
        <colgroup>
          <col style={{ width: GUTTER_WIDTH }} />
          {sheet.cols.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th {...stylex.props(styles.gutter, styles.corner, styles.headCell)} />
            {sheet.cols.map((_, index) => (
              <th
                key={index}
                {...sx(
                  [
                    styles.gutter,
                    styles.headCell,
                    index === frozenCols - 1 && styles.frozenColumnLast,
                  ],
                  undefined,
                  index >= frozenCols
                    ? undefined
                    : { insetInlineStart: frozenColOffsets[index], zIndex: 4 },
                )}
              >
                {columnName(index + 1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row) => {
            const frozen = row.r <= frozenRows;
            const lastFrozenRow = frozen && row.r === frozenRows;
            return (
              <tr
                data-frozen={frozen ? '' : undefined}
                key={row.r}
                style={row.h ? { height: pointToPixel(row.h) } : undefined}
              >
                <th
                  {...stylex.props(
                    styles.gutter,
                    styles.rowHead,
                    frozen && styles.frozenCell,
                    lastFrozenRow && styles.frozenLastCell,
                  )}
                >
                  {row.r}
                </th>
                {row.cells.map((cell) => (
                  <GridCell
                    cell={cell}
                    frozenRow={frozen}
                    key={cell.c}
                    lastFrozenCol={cell.c === frozenCols}
                    lastFrozenRow={lastFrozenRow}
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
