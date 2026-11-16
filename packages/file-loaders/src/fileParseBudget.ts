/**
 * Why a file was refused before or during parsing. The values describe structure only,
 * never file content:
 * - `zip-input`: the compressed archive itself is too large
 * - `zip-entries`: the archive declares too many entries
 * - `zip-expansion`: the entries inflate to too much data in total
 * - `sheet-xml`: one worksheet part inflates to too much data
 * - `sheet-cells`: the rectangle that spans the real cells of a sheet is too large
 */
export type FileParseBudgetReason =
  'sheet-cells' | 'sheet-xml' | 'zip-entries' | 'zip-expansion' | 'zip-input';

/**
 * A file exceeds a fixed structural budget (input size, entry count, inflated size, cell area). It is a
 * deliberate refusal, not a corrupt file, so loaders rethrow it instead of returning an error
 * page and callers can tell the user the file is too large.
 *
 * `limit` and `actual` use the unit of the reason: entries, bytes or cells.
 */
export class FileParseBudgetError extends Error {
  actual: number;
  limit: number;
  reason: FileParseBudgetReason;

  constructor(reason: FileParseBudgetReason, limit: number, actual: number) {
    super(`File exceeds the parse budget (${reason}): ${actual} > ${limit}`);
    this.name = 'FileParseBudgetError';
    this.reason = reason;
    this.limit = limit;
    this.actual = actual;
  }
}

/**
 * Name based so it still matches after the error crossed a module-copy or worker boundary.
 */
export const isFileParseBudgetError = (error: unknown): error is FileParseBudgetError =>
  error instanceof FileParseBudgetError ||
  (error instanceof Error && error.name === 'FileParseBudgetError');
