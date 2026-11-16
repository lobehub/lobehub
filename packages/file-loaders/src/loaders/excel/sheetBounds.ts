import * as xlsx from 'xlsx';

import { FileParseBudgetError } from '../../fileParseBudget';

/** Largest rectangle (rows x columns) spanning the real cells of one sheet. */
export const MAX_SHEET_CELLS = 5_000_000;

export interface SheetBoundsOptions {
  maxCells?: number;
}

/** A stub (`t: 'z'`) or a cell with neither value, formula nor text carries only style. */
const isRealCell = (cell: xlsx.CellObject | undefined): boolean =>
  !!cell &&
  typeof cell === 'object' &&
  cell.t !== 'z' &&
  (cell.v !== undefined && cell.v !== null ? true : cell.f !== undefined || cell.w !== undefined);

/**
 * Shrinks the end of `!ref` to the last row/column holding a real cell, keeping the declared
 * start so header semantics stay as they were. Spreadsheets routinely declare a used range of
 * a million styled-but-empty rows; `sheet_to_json` walks the whole declared rectangle, so
 * the range is clamped first.
 *
 * Only the cells that exist in the sheet object are visited, never the declared rectangle.
 * Cells outside the declared range are ignored (as `sheet_to_json` would). A sheet with no
 * real cell collapses to its start cell. Throws `FileParseBudgetError('sheet-cells')` when the
 * clamped rectangle is still above the budget. Mutates `worksheet`.
 */
export const clampSheetRefToData = (
  worksheet: xlsx.WorkSheet | undefined,
  { maxCells = MAX_SHEET_CELLS }: SheetBoundsOptions = {},
): void => {
  const ref = worksheet?.['!ref'];
  if (!worksheet || !ref) return;

  const range = xlsx.utils.decode_range(ref);
  let lastRow = range.s.r;
  let lastCol = range.s.c;

  for (const key in worksheet) {
    if (key.charCodeAt(0) === 33 /* "!" */) continue;
    if (!isRealCell(worksheet[key] as xlsx.CellObject)) continue;

    const { c, r } = xlsx.utils.decode_cell(key);
    if (r < range.s.r || r > range.e.r || c < range.s.c || c > range.e.c) continue;
    if (r > lastRow) lastRow = r;
    if (c > lastCol) lastCol = c;
  }

  const area = (lastRow - range.s.r + 1) * (lastCol - range.s.c + 1);
  if (area > maxCells) throw new FileParseBudgetError('sheet-cells', maxCells, area);

  worksheet['!ref'] = xlsx.utils.encode_range({
    e: { c: lastCol, r: lastRow },
    s: range.s,
  });
};
