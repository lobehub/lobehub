import { isFileParseBudgetError } from '@lobechat/file-loaders';

import { AsyncTaskErrorType } from '@/types/asyncTask';

import { isFileParseError } from './errors';

/** Follows `cause` (a TRPCError wraps the original parse error) to the parse error underneath. */
const findParseFailure = (error: unknown) => {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (isFileParseBudgetError(current) || isFileParseError(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

const DETERMINISTIC_CODES = new Set([
  'INPUT_TOO_LARGE',
  'LOAD_FAILED',
  'OUT_OF_MEMORY',
  'OUTPUT_TOO_LARGE',
  'PARSE_FAILED',
  'TIMEOUT',
]);
const TOO_LARGE_CODES = new Set(['INPUT_TOO_LARGE', 'OUT_OF_MEMORY', 'OUTPUT_TOO_LARGE']);

/**
 * The same file would fail the same way again: a structural budget, a file that does not parse,
 * a result too large, a heap or time limit. Saturation (`QUEUE_FULL`, `QUEUE_TIMEOUT`) and a
 * missing artifact are not: a later or different attempt may succeed, and a type error from
 * outside the parse worker is not a parse verdict at all.
 *
 * It says nothing about whether another parser would fail too (see {@link isSharedLimitFailure}):
 * callers use it to tell a bad file from a busy server, not to skip the next parser.
 */
export const isDeterministicParseFailure = (error: unknown): boolean => {
  const failure = findParseFailure(error);
  if (!failure) return false;
  return (
    isFileParseBudgetError(failure) || DETERMINISTIC_CODES.has((failure as { code: string }).code)
  );
};

/**
 * Budget reasons raised by `preflightXlsxZip`, which the document-view parse, the chunk job and
 * the dataset parse all run before any loader. `sheet-cells` is not here: only the SheetJS loader
 * enforces it, the chunk loader (ExcelJS) never does.
 */
const SHARED_ZIP_BUDGET_REASONS = new Set([
  'sheet-xml',
  'zip-entries',
  'zip-expansion',
  'zip-input',
]);

/**
 * The refusal comes from a limit every parse path applies to the same bytes (the input size cap
 * before any worker starts, the xlsx ZIP structure preflight), so another path would be refused
 * the same way. Any other failure is one parser's verdict (it could not read the file, ran out of
 * time or heap, or hit a limit only it enforces): a different parser, such as the chunk loader
 * after the document-view parse, may still succeed, within the same worker, heap and timeout.
 */
export const isSharedLimitFailure = (error: unknown): boolean => {
  const failure = findParseFailure(error);
  if (!failure) return false;
  if (isFileParseBudgetError(failure)) return SHARED_ZIP_BUDGET_REASONS.has(failure.reason);
  return (failure as { code: string }).code === 'INPUT_TOO_LARGE';
};

/**
 * The existing task error type that describes a deterministic failure to the member: too large
 * (budget, input, output, heap) or timed out. Everything else keeps the error's own name.
 */
export const toAsyncTaskErrorType = (error: unknown): AsyncTaskErrorType | undefined => {
  const failure = findParseFailure(error);
  if (!failure) return undefined;
  if (isFileParseBudgetError(failure)) return AsyncTaskErrorType.FileTooLargeToParse;

  const code = (failure as { code: string }).code;
  if (TOO_LARGE_CODES.has(code)) return AsyncTaskErrorType.FileTooLargeToParse;
  if (code === 'TIMEOUT') return AsyncTaskErrorType.Timeout;
  return undefined;
};
