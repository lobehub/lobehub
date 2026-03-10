// Source copied from: https://github.com/moeru-ai/std/blob/72279973ff997b65672a9c85555c3736554bd9b9/packages/std/src/error/index.ts#L41-L46

type Nullable<T> = {
  [P in keyof T]: null | T[P];
};

/**
 * ErrorLike utility interface for containing error-like objects.
 */
export type ErrorLike<C = unknown> = Nullable<Partial<Pick<Error, 'stack'>>> &
  Pick<Error, 'message' | 'name'> & { cause?: C };

export const isError = (err: null | undefined | unknown): err is Error => err instanceof Error;

export const isErrorLike = <C = unknown>(err: null | undefined | unknown): err is ErrorLike<C> => {
  if (err == null) return false;

  if (isError(err)) return true;

  if (typeof err !== 'object') return false;

  return (
    'name' in err &&
    typeof err.name === 'string' &&
    'message' in err &&
    typeof err.message === 'string'
  );
};

/**
 * Error.name extractor.
 *
 * @param {Error} err
 * @returns {string | undefined}
 */
export const errorNameFrom = (err: null | undefined | unknown): string | undefined =>
  isErrorLike(err) ? err.name : undefined;

/**
 * Error.message extractor.
 *
 * @param {Error} err
 * @returns {string | undefined}
 */
export const errorMessageFrom = (err: null | undefined | unknown): string | undefined =>
  isErrorLike(err) ? err.message : undefined;

/**
 * Error.stack extractor.
 *
 * @param {Error} err
 * @returns {string | undefined}
 */
export const errorStackFrom = (err: null | undefined | unknown): null | string | undefined =>
  isErrorLike(err) ? (err.stack ?? new Error(errorMessageFrom(err)).stack) : undefined;

/**
 * Error.cause extractor.
 *
 * @param {Error} err
 * @returns {unknown | undefined}
 */
export const errorCauseFrom = <C>(err: null | undefined | unknown): C | undefined => {
  if (!isErrorLike(err) || err.cause == null) return undefined;

  return err.cause as C | undefined;
};
