import { FileParseBudgetError } from '@lobechat/file-loaders';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { AsyncTaskErrorType } from '@/types/asyncTask';

import { FileParseError } from './errors';
import { isDeterministicParseFailure, isSharedLimitFailure, toAsyncTaskErrorType } from './failure';
import { normalizeParseFileError } from './normalizeError';

describe('isDeterministicParseFailure', () => {
  it.each([
    'INPUT_TOO_LARGE',
    'LOAD_FAILED',
    'OUT_OF_MEMORY',
    'OUTPUT_TOO_LARGE',
    'PARSE_FAILED',
    'TIMEOUT',
  ] as const)('treats %s as a verdict on the file, also behind a TRPCError', (code) => {
    const error = new FileParseError(code, 'x');

    expect(isDeterministicParseFailure(error)).toBe(true);
    expect(isDeterministicParseFailure(normalizeParseFileError(error))).toBe(true);
  });

  it('treats a budget refusal as deterministic', () => {
    const budget = new FileParseBudgetError('sheet-xml', 10, 20);

    expect(isDeterministicParseFailure(budget)).toBe(true);
    expect(isDeterministicParseFailure(normalizeParseFileError(budget))).toBe(true);
  });

  it.each(['QUEUE_FULL', 'QUEUE_TIMEOUT', 'START_FAILED', 'UNAVAILABLE', 'WORKER_FAILED'] as const)(
    'does not treat %s as a verdict: a later attempt may succeed',
    (code) => {
      expect(
        isDeterministicParseFailure(normalizeParseFileError(new FileParseError(code, 'x'))),
      ).toBe(false);
    },
  );

  it('does not treat unrelated errors as parse verdicts', () => {
    expect(isDeterministicParseFailure(new Error('db down'))).toBe(false);
    expect(isDeterministicParseFailure(new TRPCError({ code: 'BAD_REQUEST', message: 'x' }))).toBe(
      false,
    );
    expect(isDeterministicParseFailure(undefined)).toBe(false);
  });

  it('recognizes errors made by another copy of the classes, by name and code', () => {
    const foreign = Object.assign(new Error('x'), { code: 'TIMEOUT', name: 'FileParseError' });

    expect(isDeterministicParseFailure(foreign)).toBe(true);
  });
});

describe('isSharedLimitFailure', () => {
  it.each(['sheet-xml', 'zip-entries', 'zip-expansion', 'zip-input'] as const)(
    'treats the shared ZIP preflight reason %s as refused for every parser, also behind a TRPCError',
    (reason) => {
      const budget = new FileParseBudgetError(reason, 1, 2);

      expect(isSharedLimitFailure(budget)).toBe(true);
      expect(isSharedLimitFailure(normalizeParseFileError(budget))).toBe(true);
    },
  );

  it('treats the input size cap as shared, behind a TRPCError and from another bundle copy', () => {
    const tooLarge = new FileParseError('INPUT_TOO_LARGE', 'x');

    expect(isSharedLimitFailure(tooLarge)).toBe(true);
    expect(isSharedLimitFailure(normalizeParseFileError(tooLarge))).toBe(true);
    expect(
      isSharedLimitFailure(
        Object.assign(new Error('x'), { code: 'INPUT_TOO_LARGE', name: 'FileParseError' }),
      ),
    ).toBe(true);
  });

  it('leaves the limits only one parser enforces, and one parser own failures, to the next parser', () => {
    expect(isSharedLimitFailure(new FileParseBudgetError('sheet-cells', 1, 2))).toBe(false);
    for (const code of [
      'LOAD_FAILED',
      'OUT_OF_MEMORY',
      'OUTPUT_TOO_LARGE',
      'PARSE_FAILED',
      'QUEUE_FULL',
      'TIMEOUT',
      'WORKER_FAILED',
    ] as const) {
      expect(isSharedLimitFailure(normalizeParseFileError(new FileParseError(code, 'x')))).toBe(
        false,
      );
    }
    expect(isSharedLimitFailure(new Error('db down'))).toBe(false);
  });
});

describe('toAsyncTaskErrorType', () => {
  it('reuses the existing too-large and timeout task errors', () => {
    expect(toAsyncTaskErrorType(new FileParseBudgetError('zip-input', 1, 2))).toBe(
      AsyncTaskErrorType.FileTooLargeToParse,
    );
    for (const code of ['INPUT_TOO_LARGE', 'OUT_OF_MEMORY', 'OUTPUT_TOO_LARGE'] as const) {
      expect(toAsyncTaskErrorType(normalizeParseFileError(new FileParseError(code, 'x')))).toBe(
        AsyncTaskErrorType.FileTooLargeToParse,
      );
    }
    expect(toAsyncTaskErrorType(new FileParseError('TIMEOUT', 'x'))).toBe(
      AsyncTaskErrorType.Timeout,
    );
  });

  it('leaves everything else to the error own name', () => {
    expect(toAsyncTaskErrorType(new FileParseError('PARSE_FAILED', 'x'))).toBeUndefined();
    expect(toAsyncTaskErrorType(new Error('x'))).toBeUndefined();
  });
});
