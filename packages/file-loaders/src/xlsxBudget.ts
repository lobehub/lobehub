/**
 * Lightweight entry for callers that parse spreadsheets themselves (for example the dataset
 * parser) and only need the budget helpers, without loading any file loader.
 */
export type { FileParseBudgetReason } from './fileParseBudget';
export { FileParseBudgetError, isFileParseBudgetError } from './fileParseBudget';
export type { SheetBoundsOptions } from './loaders/excel/sheetBounds';
export { clampSheetRefToData, MAX_SHEET_CELLS } from './loaders/excel/sheetBounds';
export type { XlsxZipLimits } from './loaders/excel/zipBudget';
export { DEFAULT_XLSX_ZIP_LIMITS, preflightXlsxZip } from './loaders/excel/zipBudget';
