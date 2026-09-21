import type { Border, Cell, Color, Row, Worksheet } from 'exceljs';

export interface CellStyle {
  b?: 1;
  bd?: Partial<Record<'b' | 'l' | 'r' | 't', [number, string]>>;
  bg?: string;
  fc?: string;
  ff?: string;
  fs?: number;
  h?: string;
  i?: 1;
  v?: string;
  w?: 1;
}

export interface CellModel {
  c: number;
  cs?: number;
  rs?: number;
  s: CellStyle;
  t: string;
}

export interface RowModel {
  cells: CellModel[];
  h: number | null;
  r: number;
}

export interface SheetModel {
  cols: number[];
  frozen: { cols: number; rows: number } | null;
  name: string;
  rowCount: number;
  rows: RowModel[];
  truncated: boolean;
}

export const MAX_PREVIEW_ROWS = 500;

const hex = (color?: Partial<Color>): string | undefined => {
  const argb = color?.argb;
  if (!argb) return undefined;
  return '#' + (argb.length === 8 ? argb.slice(2) : argb);
};

const formatNumber = (value: number, numFmt?: string): string => {
  if (!numFmt || numFmt === 'General') return String(Math.round(value * 1e10) / 1e10);
  const sections = numFmt.split(';');
  const usesNegativeSection = value < 0 && Boolean(sections[1]);
  const pattern = usesNegativeSection
    ? sections[1]
    : value === 0 && sections[2]
      ? sections[2]
      : sections[0];
  if (!/[0#]/.test(pattern)) return pattern.replaceAll('"', '');

  const isPercentage = pattern.includes('%');
  const displayValue = Math.abs(isPercentage ? value * 100 : value);
  const scientific = /E[+-]?(0+)/i.exec(pattern);
  const decimalPattern = pattern.match(/\.([0#]+)/)?.[1] ?? '';
  const decimals = decimalPattern.length;
  const requiredDecimals = decimalPattern.replaceAll('#', '').length;
  const firstPlaceholder = pattern.search(/[0#]/);
  const lastPlaceholder = Math.max(pattern.lastIndexOf('0'), pattern.lastIndexOf('#'));
  const sign = value < 0 && !usesNegativeSection ? '-' : '';
  const prefix = pattern.slice(0, firstPlaceholder).replaceAll('"', '');
  const suffix = pattern.slice(lastPlaceholder + 1).replaceAll('"', '');

  if (scientific) {
    const [mantissa, exponent] = displayValue.toExponential(decimals).split('e');
    const exponentValue = Number(exponent);
    const exponentSign = exponentValue < 0 ? '-' : '+';
    const exponentBody = String(Math.abs(exponentValue)).padStart(scientific[1].length, '0');

    return sign + prefix + mantissa + 'E' + exponentSign + exponentBody + suffix;
  }
  const body = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: requiredDecimals,
    useGrouping: pattern.includes('#,##'),
  }).format(displayValue);

  return sign + prefix + body + suffix;
};

const formatCellValue = (value: Cell['value'] | unknown, numFmt?: string): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return formatNumber(value, numFmt);
  if (typeof value === 'object') {
    const rich = value as {
      error?: string;
      formula?: string;
      result?: unknown;
      richText?: { text: string }[];
      sharedFormula?: string;
      text?: unknown;
    };
    if (rich.richText) return rich.richText.map((run) => run.text).join('');
    if (rich.formula !== undefined || rich.sharedFormula !== undefined) {
      const result = rich.result;
      return formatCellValue(result, numFmt);
    }
    if (rich.text !== undefined) return String(rich.text);
    return rich.error ?? '';
  }
  return String(value);
};

const cellText = (cell: Cell): string => formatCellValue(cell.value, cell.numFmt);

const isNumericCell = (cell: Cell): boolean => {
  const value = cell.value;
  if (typeof value === 'number') return true;
  return typeof (value as { result?: unknown })?.result === 'number';
};

const BORDER_WIDTH: Record<string, number> = {
  double: 3,
  hair: 1,
  medium: 2,
  thick: 3,
  thin: 1,
};

const borderSide = (side?: Partial<Border>): [number, string] | undefined =>
  side?.style ? [BORDER_WIDTH[side.style] ?? 1, hex(side.color) ?? '#bfbfbf'] : undefined;

const readCellStyle = (cell: Cell, numeric: boolean): CellStyle => {
  const font = cell.font ?? {};
  const alignment = cell.alignment ?? {};
  const border = cell.border ?? {};
  const style: CellStyle = { h: alignment.horizontal ?? (numeric ? 'right' : 'left') };

  if (font.bold) style.b = 1;
  if (font.italic) style.i = 1;
  if (font.size) style.fs = font.size;
  if (font.name) style.ff = font.name;
  const fontColor = hex(font.color);
  if (fontColor) style.fc = fontColor;

  const fill = cell.fill;
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const background = hex(fill.fgColor);
    if (background) style.bg = background;
  }

  if (alignment.vertical) style.v = alignment.vertical;
  if (alignment.wrapText) style.w = 1;

  const sides: CellStyle['bd'] = {};
  for (const [key, side] of [
    ['t', border.top],
    ['l', border.left],
    ['b', border.bottom],
    ['r', border.right],
  ] as const) {
    const parsed = borderSide(side);
    if (parsed) sides[key] = parsed;
  }
  if (Object.keys(sides).length > 0) style.bd = sides;

  return style;
};

const columnLetterToIndex = (letters: string): number =>
  [...letters].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);

const readMerges = (sheet: Worksheet, rowIndexes: number[], colCount: number) => {
  const spans = new Map<string, [number, number]>();
  const covered = new Set<string>();
  const renderedRows = new Set(rowIndexes);

  for (const ref of Object.values(sheet.model.merges ?? {}) as string[]) {
    const parsed = /([A-Z]+)(\d+):([A-Z]+)(\d+)/.exec(ref);
    if (!parsed) continue;
    const startCol = columnLetterToIndex(parsed[1]);
    const startRow = Number(parsed[2]);
    const endCol = columnLetterToIndex(parsed[3]);
    const endRow = Number(parsed[4]);
    if (!renderedRows.has(startRow) || startCol > colCount) continue;

    const rowSpan = rowIndexes.filter((row) => row >= startRow && row <= endRow).length;
    const colSpan = Math.min(endCol, colCount) - startCol + 1;
    spans.set(`${startRow}:${startCol}`, [rowSpan, colSpan]);
    for (const row of rowIndexes) {
      if (row < startRow || row > endRow) continue;
      for (let col = startCol; col <= Math.min(endCol, colCount); col++) {
        if (row !== startRow || col !== startCol) covered.add(`${row}:${col}`);
      }
    }
  }

  return { covered, spans };
};

const readSheet = (sheet: Worksheet): SheetModel => {
  const colCount = Math.max(sheet.actualColumnCount, 1);
  const view = sheet.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
  const previewRows: Row[] = [];
  sheet.eachRow((row: Row) => {
    if (previewRows.length < MAX_PREVIEW_ROWS) previewRows.push(row);
  });
  const rowIndexes = previewRows.map((row) => row.number);
  const { covered, spans } = readMerges(sheet, rowIndexes, colCount);

  const rows: RowModel[] = [];
  for (const row of previewRows) {
    const rowIndex = row.number;
    const cells: CellModel[] = [];
    for (let colIndex = 1; colIndex <= colCount; colIndex++) {
      if (covered.has(`${rowIndex}:${colIndex}`)) continue;
      const cell = row.getCell(colIndex);
      const text = cellText(cell);
      const style = readCellStyle(cell, isNumericCell(cell));
      const span = spans.get(`${rowIndex}:${colIndex}`);
      if (!text && !style.bg && !style.bd && !span) {
        cells.push({ c: colIndex, s: {}, t: '' });
        continue;
      }
      cells.push({
        c: colIndex,
        s: style,
        t: text,
        ...(span ? { cs: span[1], rs: span[0] } : {}),
      });
    }
    rows.push({ cells, h: row.height ?? null, r: rowIndex });
  }

  const cols: number[] = [];
  for (let colIndex = 1; colIndex <= colCount; colIndex++) {
    cols.push(Math.round((sheet.getColumn(colIndex).width ?? 8.43) * 7 + 5));
  }

  return {
    cols,
    frozen: view?.state === 'frozen' ? { cols: view.xSplit ?? 0, rows: view.ySplit ?? 0 } : null,
    name: sheet.name,
    rowCount: rows.length,
    rows,
    truncated: sheet.actualRowCount > MAX_PREVIEW_ROWS,
  };
};

export const readWorkbook = async (blob: Blob): Promise<SheetModel[]> => {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  return workbook.worksheets.map((sheet) => readSheet(sheet));
};
