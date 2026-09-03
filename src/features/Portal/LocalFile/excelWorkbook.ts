import type { Cell, CellValue, Workbook, Worksheet } from 'exceljs';

export const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ExcelNumberFormat = '0' | '0.00' | '0.0%' | '$#,##0.00';

const CELL_REFERENCE = /(?:(?:'([^']+)'|([A-Za-z_][\w ]*))!)?\$?([A-Z]+)\$?(\d+)/g;
const FUNCTION_CALL = /\b(SUM|AVERAGE|MIN|MAX|COUNT)\(([^()]*)\)/gi;

const columnIndex = (name: string) =>
  [...name].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);

const columnName = (index: number) => {
  let name = '';
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
};

const arithmetic = (source: string): number => {
  const tokens = source.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  let cursor = 0;
  const expression = (): number => {
    let value = term();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++];
      const right = term();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const term = (): number => {
    let value = factor();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++];
      const right = factor();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };
  const factor = (): number => {
    const token = tokens[cursor++];
    if (token === '-') return -factor();
    if (token === '(') {
      const value = expression();
      if (tokens[cursor++] !== ')') throw new Error('Unbalanced formula');
      return value;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error('Unsupported formula');
    return value;
  };
  const result = expression();
  if (cursor !== tokens.length || !Number.isFinite(result)) throw new Error('Invalid formula');
  return result;
};

const scalar = (cell: Cell): number => {
  const value = cell.value;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value && 'result' in value) return Number(value.result) || 0;
  return Number(value) || 0;
};

const resolveSheet = (workbook: Workbook, current: Worksheet, name?: string) =>
  name ? (workbook.getWorksheet(name) ?? current) : current;

const valuesFromArgument = (workbook: Workbook, sheet: Worksheet, argument: string): number[] => {
  const range = argument.trim();
  const match = range.match(
    /^(?:(?:'([^']+)'|([A-Za-z_][\w ]*))!)?\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/,
  );
  if (!match) {
    const numeric = Number(range);
    if (Number.isFinite(numeric)) return [numeric];
    let resolved = 0;
    range.replaceAll(CELL_REFERENCE, (_, quoted, bare, column, row) => {
      resolved = scalar(resolveSheet(workbook, sheet, quoted ?? bare).getCell(`${column}${row}`));
      return '';
    });
    return [resolved];
  }
  const [, quoted, bare, startColumn, startRow, endColumn, endRow] = match;
  const target = resolveSheet(workbook, sheet, quoted ?? bare);
  const values: number[] = [];
  for (let row = Number(startRow); row <= Number(endRow); row++) {
    for (let column = columnIndex(startColumn); column <= columnIndex(endColumn); column++) {
      values.push(scalar(target.getCell(row, column)));
    }
  }
  return values;
};

export const calculateFormula = (workbook: Workbook, sheet: Worksheet, formula: string): number => {
  let source = formula.replace(/^=/, '');
  for (let pass = 0; pass < 10 && FUNCTION_CALL.test(source); pass++) {
    FUNCTION_CALL.lastIndex = 0;
    source = source.replace(FUNCTION_CALL, (_, name: string, rawArguments: string) => {
      const values = rawArguments
        .split(',')
        .flatMap((argument) => valuesFromArgument(workbook, sheet, argument));
      switch (name.toUpperCase()) {
        case 'AVERAGE': {
          return String(values.reduce((sum, value) => sum + value, 0) / (values.length || 1));
        }
        case 'COUNT': {
          return String(values.length);
        }
        case 'MAX': {
          return String(Math.max(...values));
        }
        case 'MIN': {
          return String(Math.min(...values));
        }
        default: {
          return String(values.reduce((sum, value) => sum + value, 0));
        }
      }
    });
  }
  source = source.replaceAll(CELL_REFERENCE, (_, quoted, bare, column, row) =>
    String(scalar(resolveSheet(workbook, sheet, quoted ?? bare).getCell(`${column}${row}`))),
  );
  return arithmetic(source);
};

export const recalculateWorkbook = (workbook: Workbook) => {
  // A few passes allow ordinary dependent and cross-sheet formulas to settle.
  for (let pass = 0; pass < 4; pass++) {
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          const value = cell.value;
          if (typeof value !== 'object' || !value || !('formula' in value)) return;
          const formula = value.formula;
          if (!formula) return;
          try {
            cell.value = {
              formula,
              result: calculateFormula(workbook, sheet, formula),
            };
          } catch {
            // Preserve the imported cached result for formulas outside the supported common subset.
          }
        });
      });
    });
  }
};

export const setCellInput = (
  workbook: Workbook,
  sheet: Worksheet,
  address: string,
  input: string,
) => {
  const cell = sheet.getCell(address);
  if (!input) cell.value = null;
  else if (input.startsWith('=')) {
    cell.value = { formula: input.slice(1), result: calculateFormula(workbook, sheet, input) };
  } else {
    const numeric = Number(input);
    cell.value = input.trim() !== '' && Number.isFinite(numeric) ? numeric : input;
  }
  recalculateWorkbook(workbook);
};

const rewriteReferences = (
  workbook: Workbook,
  targetSheet: Worksheet,
  axis: 'column' | 'row',
  start: number,
  delta: number,
) => {
  workbook.eachSheet((formulaSheet) => {
    formulaSheet.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.value;
        if (typeof value !== 'object' || !value || !('formula' in value) || !value.formula) return;
        const formula = value.formula.replaceAll(
          CELL_REFERENCE,
          (reference, quoted, bare, column: string, rowNumber: string) => {
            const referencedSheet = quoted ?? bare;
            if (
              referencedSheet ? referencedSheet !== targetSheet.name : formulaSheet !== targetSheet
            )
              return reference;
            const current = axis === 'row' ? Number(rowNumber) : columnIndex(column);
            if (current < start) return reference;
            const shifted = Math.max(1, current + delta);
            const prefix = referencedSheet ? `'${referencedSheet}'!` : '';
            return `${prefix}${axis === 'column' ? columnName(shifted) : column}${
              axis === 'row' ? shifted : rowNumber
            }`;
          },
        );
        cell.value = { formula, result: value.result };
      });
    });
  });
};

export const spliceWorksheetRows = (
  workbook: Workbook,
  sheet: Worksheet,
  start: number,
  deleteCount: number,
) => {
  sheet.spliceRows(start, deleteCount, ...(deleteCount ? [] : [[]]));
  rewriteReferences(workbook, sheet, 'row', start, deleteCount ? -deleteCount : 1);
  recalculateWorkbook(workbook);
};

export const spliceWorksheetColumns = (
  workbook: Workbook,
  sheet: Worksheet,
  start: number,
  deleteCount: number,
) => {
  sheet.spliceColumns(start, deleteCount, ...(deleteCount ? [] : [[]]));
  rewriteReferences(workbook, sheet, 'column', start, deleteCount ? -deleteCount : 1);
  recalculateWorkbook(workbook);
};

export const displayCell = (cell: Cell): string => {
  const value = cell.value as CellValue;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('formula' in value) return String(value.result ?? '');
    if ('richText' in value) return value.richText.map((run) => run.text).join('');
    if ('text' in value) return value.text;
    if ('error' in value) return value.error;
  }
  return String(value);
};

export const formulaInput = (cell: Cell): string => {
  const value = cell.value;
  return typeof value === 'object' && value && 'formula' in value
    ? `=${value.formula}`
    : displayCell(cell);
};

export const moveWorksheet = (workbook: Workbook, from: number, to: number) => {
  if (to < 0 || to >= workbook.worksheets.length || from === to) return;
  const ordered = workbook.worksheets;
  const [moved] = ordered.splice(from, 1);
  if (!moved) return;
  ordered.splice(to, 0, moved);
  ordered.forEach((sheet, index) => {
    (sheet as Worksheet & { orderNo: number }).orderNo = index + 1;
  });
};

export const applyCellFormat = (
  cell: Cell,
  format: {
    align?: 'center' | 'left' | 'right';
    bold?: boolean;
    fill?: string;
    italic?: boolean;
    numberFormat?: ExcelNumberFormat;
  },
) => {
  if (format.bold !== undefined || format.italic !== undefined) {
    cell.font = {
      ...cell.font,
      bold: format.bold ?? cell.font?.bold,
      italic: format.italic ?? cell.font?.italic,
    };
  }
  if (format.align) cell.alignment = { ...cell.alignment, horizontal: format.align };
  if (format.fill)
    cell.fill = {
      fgColor: { argb: format.fill.replace('#', 'FF') },
      pattern: 'solid',
      type: 'pattern',
    };
  if (format.numberFormat) cell.numFmt = format.numberFormat;
};
