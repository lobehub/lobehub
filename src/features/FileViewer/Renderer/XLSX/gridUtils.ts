export interface CellCoordinates {
  column: number;
  row: number;
}

export interface RangeBounds {
  end: CellCoordinates;
  start: CellCoordinates;
}

export const columnName = (column: number) => {
  let name = '';
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
};

export const parseCellAddress = (address: string): CellCoordinates => {
  const match = address.match(/^([A-Z]+)(\d+)$/u);
  if (!match) throw new Error(`Invalid cell address: ${address}`);
  const column = [...match[1]].reduce((sum, value) => sum * 26 + value.charCodeAt(0) - 64, 0);
  return { column, row: Number(match[2]) };
};

export const cellAddress = ({ column, row }: CellCoordinates) => `${columnName(column)}${row}`;

export const rangeBetween = (anchor: string, focus: string): RangeBounds => {
  const from = parseCellAddress(anchor);
  const to = parseCellAddress(focus);
  return {
    end: { column: Math.max(from.column, to.column), row: Math.max(from.row, to.row) },
    start: { column: Math.min(from.column, to.column), row: Math.min(from.row, to.row) },
  };
};

export const rangeAddress = (bounds: RangeBounds) => {
  const start = cellAddress(bounds.start);
  const end = cellAddress(bounds.end);
  return start === end ? start : `${start}:${end}`;
};

export const rangeSize = (bounds: RangeBounds) => ({
  columns: bounds.end.column - bounds.start.column + 1,
  rows: bounds.end.row - bounds.start.row + 1,
});

/** The paste target range: the copied block's size anchored at the given cell. */
export const rangeAnchoredAt = (anchor: string, size: { columns: number; rows: number }) => {
  const start = parseCellAddress(anchor);
  return rangeAddress({
    end: { column: start.column + size.columns - 1, row: start.row + size.rows - 1 },
    start,
  });
};

export const isInBounds = (bounds: RangeBounds, row: number, column: number) =>
  row >= bounds.start.row &&
  row <= bounds.end.row &&
  column >= bounds.start.column &&
  column <= bounds.end.column;

const groupThousands = (integer: string) => integer.replaceAll(/\B(?=(\d{3})+(?!\d))/gu, ',');

/**
 * Render a numeric cell through its Excel number format for on-grid display.
 * Covers the formats the editor offers (thousands separator, fixed decimals,
 * currency prefix, percent suffix); anything else falls through unformatted.
 */
export const formatCellNumber = (value: number, numberFormat?: string): string | undefined => {
  if (!numberFormat || numberFormat === 'General') return undefined;
  const pattern = numberFormat.match(/^(\$?)(#,##0|0)(?:\.(0+))?(%?)$/u);
  if (!pattern) return undefined;
  const [, currency, integerPattern, decimals, percent] = pattern;
  const scaled = percent ? value * 100 : value;
  const fixed = Math.abs(scaled).toFixed(decimals?.length ?? 0);
  const [integer, fraction] = fixed.split('.');
  const grouped = integerPattern === '#,##0' ? groupThousands(integer) : integer;
  const sign = scaled < 0 ? '-' : '';
  return `${sign}${currency}${grouped}${fraction ? `.${fraction}` : ''}${percent}`;
};
