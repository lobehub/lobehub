import ExcelJS from 'exceljs';

export interface XlsxCellStyle {
  bold?: boolean;
  fill?: string;
  horizontal?: 'center' | 'left' | 'right';
  italic?: boolean;
  numberFormat?: string;
}

export type XlsxEditOperation =
  | { range: string; sheet: string; type: 'clearRange' }
  | { ranges: string[]; sheet: string; type: 'clearAreas' }
  | { range: string; sheet: string; style: XlsxCellStyle; type: 'setStyle' }
  | { range: string; sheet: string; type: 'setCells'; values: (number | string | null)[][] }
  | {
      areas: Array<{ range: string; values: (number | string | null)[][] }>;
      sheet: string;
      type: 'setAreas';
    }
  | { from: string; sheet: string; to: string; type: 'copyRange' }
  | { at: number; count?: number; sheet: string; type: 'insertRows' | 'deleteRows' }
  | { at: number; count?: number; sheet: string; type: 'insertColumns' | 'deleteColumns' }
  | { name: string; type: 'addSheet' }
  | { name: string; newName: string; type: 'renameSheet' }
  | { fromIndex: number; toIndex: number; type: 'moveSheet' }
  | { name: string; type: 'deleteSheet' };

const MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const toArrayBuffer = (value: ExcelJS.Buffer) =>
  new Uint8Array(value as ArrayBuffer).slice().buffer;

const normalizeColor = (color: string) => color.replace(/^#/u, '').toUpperCase();

const parseInput = (value: number | string | null): ExcelJS.CellValue => {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  return { formula: value.slice(1), result: 0 };
};

const sheetOrThrow = (workbook: ExcelJS.Workbook, name: string) => {
  const sheet = workbook.worksheets.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!sheet) throw new Error(`Worksheet "${name}" does not exist`);
  return sheet;
};

const coordinates = (address: string) => {
  const match = address.replaceAll('$', '').match(/^([A-Z]+)(\d+)$/iu);
  if (!match) throw new Error(`Invalid cell address: ${address}`);
  const column = [...match[1].toUpperCase()].reduce(
    (sum, character) => sum * 26 + character.charCodeAt(0) - 64,
    0,
  );
  return { column, row: Number(match[2]) };
};

const rangeBounds = (address: string) => {
  const [start, end = start] = address.split(':');
  return { end: coordinates(end), start: coordinates(start) };
};

const columnAddress = (column: number) => {
  let address = '';
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    address = String.fromCharCode(65 + ((value - 1) % 26)) + address;
  }
  return address;
};

const adjustFormulaReferences = (
  workbook: ExcelJS.Workbook,
  editedSheet: string,
  axis: 'column' | 'row',
  at: number,
  count: number,
  direction: -1 | 1,
) => {
  workbook.eachSheet((formulaSheet) => {
    formulaSheet.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.value;
        if (!value || typeof value !== 'object' || !('formula' in value) || !value.formula) return;
        const formula = value.formula.replaceAll(
          /(?:(?:'([^']+)'|([A-Z_][\w ]*))!)?(\$?)([A-Z]+)(\$?)(\d+)/giu,
          (
            reference,
            quotedSheet: string | undefined,
            plainSheet: string | undefined,
            absoluteColumn: string,
            columnName: string,
            absoluteRow: string,
            rowNumber: string,
          ) => {
            const referenceSheet = quotedSheet || plainSheet || formulaSheet.name;
            if (referenceSheet.toLowerCase() !== editedSheet.toLowerCase()) return reference;
            const original = coordinates(`${columnName}${rowNumber}`);
            const coordinate = axis === 'row' ? original.row : original.column;
            if (coordinate < at) return reference;
            const adjusted =
              direction === 1 ? coordinate + count : Math.max(at, coordinate - count);
            const nextColumn = axis === 'column' ? columnAddress(adjusted) : columnName;
            const nextRow = axis === 'row' ? adjusted : original.row;
            const prefix = quotedSheet ? `'${quotedSheet}'!` : plainSheet ? `${plainSheet}!` : '';
            return `${prefix}${absoluteColumn}${nextColumn}${absoluteRow}${nextRow}`;
          },
        );
        cell.value = { formula, result: value.result };
      });
    });
  });
};

const eachRangeCell = (
  sheet: ExcelJS.Worksheet,
  address: string,
  run: (cell: ExcelJS.Cell, row: number, column: number) => void,
) => {
  const bounds = rangeBounds(address);
  for (let row = bounds.start.row; row <= bounds.end.row; row += 1) {
    for (let column = bounds.start.column; column <= bounds.end.column; column += 1) {
      run(sheet.getCell(row, column), row - bounds.start.row + 1, column - bounds.start.column + 1);
    }
  }
};

const numericValue = (cell: ExcelJS.Cell): number => {
  const value = cell.value;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'result' in value) return Number(value.result) || 0;
  return Number(value) || 0;
};

const resolveReference = (
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  raw: string,
) => {
  const separator = raw.lastIndexOf('!');
  const sheetName =
    separator < 0 ? currentSheet.name : raw.slice(0, separator).replaceAll(/^'|'$/gu, '');
  const address = (separator < 0 ? raw : raw.slice(separator + 1)).replaceAll('$', '');
  return { address, sheet: sheetOrThrow(workbook, sheetName) };
};

const rangeValues = (workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, reference: string) => {
  const [startReference, endAddress] = reference.split(':');
  const start = resolveReference(workbook, sheet, startReference);
  const end = resolveReference(workbook, start.sheet, endAddress || start.address);
  if (start.sheet !== end.sheet) throw new Error('A formula range cannot span worksheets');
  const values: number[] = [];
  eachRangeCell(start.sheet, `${start.address}:${end.address}`, (cell) =>
    values.push(numericValue(cell)),
  );
  return values;
};

const evaluateArithmetic = (expression: string) => {
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/]/gu) || [];
  if (tokens.join('') !== expression.replaceAll(/\s/gu, ''))
    throw new Error(`Unsupported formula: ${expression}`);
  let index = 0;
  const primary = (): number => {
    const token = tokens[index++];
    if (token === '(') {
      const value = addition();
      if (tokens[index++] !== ')') throw new Error('Unbalanced formula parentheses');
      return value;
    }
    if (token === '-') return -primary();
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error(`Invalid formula token: ${token}`);
    return value;
  };
  const multiplication = (): number => {
    let value = primary();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++];
      const right = primary();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };
  const addition = (): number => {
    let value = multiplication();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++];
      const right = multiplication();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const result = addition();
  if (index !== tokens.length || !Number.isFinite(result))
    throw new Error(`Invalid formula: ${expression}`);
  return result;
};

const evaluateFormula = (workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, formula: string) => {
  let expression = formula.toUpperCase();
  const functions = /\b(SUM|AVERAGE|MIN|MAX|COUNT)\(([^()]*)\)/gu;
  while (functions.test(expression)) {
    functions.lastIndex = 0;
    expression = expression.replace(functions, (_match, name: string, argument: string) => {
      const values = argument
        .split(',')
        .flatMap((reference) => rangeValues(workbook, sheet, reference.trim()));
      if (name === 'COUNT') return String(values.length);
      if (name === 'SUM') return String(values.reduce((sum, value) => sum + value, 0));
      if (name === 'AVERAGE')
        return String(values.reduce((sum, value) => sum + value, 0) / values.length);
      return String(name === 'MIN' ? Math.min(...values) : Math.max(...values));
    });
  }
  expression = expression.replaceAll(
    /(?:(?:'[^']+'|[A-Z_][\w ]*)!)?\$?[A-Z]+\$?\d+/gu,
    (reference) => {
      const resolved = resolveReference(workbook, sheet, reference);
      return String(numericValue(resolved.sheet.getCell(resolved.address)));
    },
  );
  return evaluateArithmetic(expression);
};

export const recalculateWorkbook = (workbook: ExcelJS.Workbook) => {
  for (let pass = 0; pass < 3; pass += 1) {
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          const value = cell.value;
          if (value && typeof value === 'object' && 'formula' in value && value.formula) {
            cell.value = {
              formula: value.formula,
              result: evaluateFormula(workbook, sheet, value.formula),
            };
          }
        });
      });
    });
  }
  workbook.calcProperties.fullCalcOnLoad = true;
};

export const loadXlsx = async (bytes: ArrayBuffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
};

export const exportXlsx = async (workbook: ExcelJS.Workbook) => {
  recalculateWorkbook(workbook);
  return toArrayBuffer(await workbook.xlsx.writeBuffer());
};

export const editXlsx = async (bytes: ArrayBuffer, operation: XlsxEditOperation) => {
  const workbook = await loadXlsx(bytes);
  switch (operation.type) {
    case 'setCells': {
      const sheet = sheetOrThrow(workbook, operation.sheet);
      const bounds = rangeBounds(operation.range);
      operation.values.forEach((row, rowIndex) =>
        row.forEach((value, columnIndex) => {
          sheet.getCell(bounds.start.row + rowIndex, bounds.start.column + columnIndex).value =
            parseInput(value);
        }),
      );
      break;
    }
    case 'clearRange': {
      eachRangeCell(sheetOrThrow(workbook, operation.sheet), operation.range, (cell) => {
        cell.value = null;
      });
      break;
    }
    case 'clearAreas': {
      const sheet = sheetOrThrow(workbook, operation.sheet);
      for (const range of operation.ranges) {
        eachRangeCell(sheet, range, (cell) => {
          cell.value = null;
        });
      }
      break;
    }
    case 'setAreas': {
      const sheet = sheetOrThrow(workbook, operation.sheet);
      for (const area of operation.areas) {
        const bounds = rangeBounds(area.range);
        area.values.forEach((row, rowIndex) =>
          row.forEach((value, columnIndex) => {
            sheet.getCell(bounds.start.row + rowIndex, bounds.start.column + columnIndex).value =
              parseInput(value);
          }),
        );
      }
      break;
    }
    case 'copyRange': {
      const sheet = sheetOrThrow(workbook, operation.sheet);
      const sourceBounds = rangeBounds(operation.from);
      eachRangeCell(sheet, operation.to, (cell, row, column) => {
        const source = sheet.getCell(
          sourceBounds.start.row + row - 1,
          sourceBounds.start.column + column - 1,
        );
        cell.value = source.value;
        cell.style = { ...source.style };
      });
      break;
    }
    case 'insertRows': {
      sheetOrThrow(workbook, operation.sheet).spliceRows(
        operation.at,
        0,
        ...Array.from({ length: operation.count || 1 }, () => []),
      );
      adjustFormulaReferences(
        workbook,
        operation.sheet,
        'row',
        operation.at,
        operation.count || 1,
        1,
      );
      break;
    }
    case 'deleteRows': {
      sheetOrThrow(workbook, operation.sheet).spliceRows(operation.at, operation.count || 1);
      adjustFormulaReferences(
        workbook,
        operation.sheet,
        'row',
        operation.at,
        operation.count || 1,
        -1,
      );
      break;
    }
    case 'insertColumns': {
      sheetOrThrow(workbook, operation.sheet).spliceColumns(
        operation.at,
        0,
        ...Array.from({ length: operation.count || 1 }, () => []),
      );
      adjustFormulaReferences(
        workbook,
        operation.sheet,
        'column',
        operation.at,
        operation.count || 1,
        1,
      );
      break;
    }
    case 'deleteColumns': {
      sheetOrThrow(workbook, operation.sheet).spliceColumns(operation.at, operation.count || 1);
      adjustFormulaReferences(
        workbook,
        operation.sheet,
        'column',
        operation.at,
        operation.count || 1,
        -1,
      );
      break;
    }
    case 'setStyle': {
      const { style } = operation;
      eachRangeCell(sheetOrThrow(workbook, operation.sheet), operation.range, (cell) => {
        if (style.bold !== undefined) cell.font = { ...cell.font, bold: style.bold };
        if (style.italic !== undefined) cell.font = { ...cell.font, italic: style.italic };
        if (style.fill)
          cell.fill = {
            fgColor: { argb: normalizeColor(style.fill) },
            pattern: 'solid',
            type: 'pattern',
          };
        if (style.horizontal) cell.alignment = { ...cell.alignment, horizontal: style.horizontal };
        if (style.numberFormat) cell.numFmt = style.numberFormat;
      });
      break;
    }
    case 'addSheet': {
      workbook.addWorksheet(operation.name);
      break;
    }
    case 'renameSheet': {
      sheetOrThrow(workbook, operation.name).name = operation.newName;
      break;
    }
    case 'moveSheet': {
      const sheets = workbook.worksheets;
      const [sheet] = sheets.splice(operation.fromIndex, 1);
      sheets.splice(operation.toIndex, 0, sheet);
      sheets.forEach((item, index) => {
        (item as ExcelJS.Worksheet & { orderNo: number }).orderNo = index;
      });
      break;
    }
    case 'deleteSheet': {
      if (workbook.worksheets.length === 1)
        throw new Error('A workbook must contain at least one worksheet');
      workbook.removeWorksheet(sheetOrThrow(workbook, operation.name).id);
      break;
    }
  }
  return exportXlsx(workbook);
};

export const XLSX_MIME_TYPE = MIME_TYPE;
