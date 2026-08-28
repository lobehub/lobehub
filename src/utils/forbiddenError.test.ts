import { describe, expect, it } from 'vitest';

import {
  getDeleteErrorMessageKey,
  isForbiddenError,
  isHistoryMigratingError,
  isOwnerOnlyForbiddenError,
} from './forbiddenError';

const trpcError = (data: Record<string, unknown>) => Object.assign(new Error('x'), { data });

describe('isForbiddenError', () => {
  it('matches FORBIDDEN code or 403 status', () => {
    expect(isForbiddenError(trpcError({ code: 'FORBIDDEN' }))).toBe(true);
    expect(isForbiddenError(trpcError({ httpStatus: 403 }))).toBe(true);
    expect(isForbiddenError(trpcError({ code: 'CONFLICT', httpStatus: 409 }))).toBe(false);
    expect(isForbiddenError(null)).toBe(false);
  });
});

describe('isOwnerOnlyForbiddenError', () => {
  it('requires the OWNER_ONLY error data on a forbidden error', () => {
    expect(
      isOwnerOnlyForbiddenError(
        trpcError({ code: 'FORBIDDEN', errorData: { code: 'OWNER_ONLY' } }),
      ),
    ).toBe(true);
    expect(isOwnerOnlyForbiddenError(trpcError({ code: 'FORBIDDEN' }))).toBe(false);
  });
});

describe('isHistoryMigratingError', () => {
  it('matches the transfer-in-progress delete conflict', () => {
    expect(
      isHistoryMigratingError(
        trpcError({
          code: 'CONFLICT',
          errorData: { code: 'TRANSFER_IN_PROGRESS' },
          httpStatus: 409,
        }),
      ),
    ).toBe(true);
  });

  it('matches the copy-in-progress delete conflict', () => {
    expect(
      isHistoryMigratingError(
        trpcError({ code: 'CONFLICT', errorData: { code: 'COPY_IN_PROGRESS' }, httpStatus: 409 }),
      ),
    ).toBe(true);
  });

  it('ignores conflicts without a migration code (e.g. edit lock)', () => {
    expect(
      isHistoryMigratingError(
        trpcError({ code: 'CONFLICT', errorData: { code: 'DocumentLocked' }, httpStatus: 409 }),
      ),
    ).toBe(false);
    expect(isHistoryMigratingError(trpcError({ code: 'CONFLICT', httpStatus: 409 }))).toBe(false);
  });

  it('ignores non-conflict errors carrying the same code', () => {
    expect(
      isHistoryMigratingError(
        trpcError({ code: 'FORBIDDEN', errorData: { code: 'TRANSFER_IN_PROGRESS' } }),
      ),
    ).toBe(false);
    expect(isHistoryMigratingError(undefined)).toBe(false);
  });
});

describe('getDeleteErrorMessageKey', () => {
  it('picks the most specific copy for each refusal', () => {
    expect(
      getDeleteErrorMessageKey(
        trpcError({
          code: 'CONFLICT',
          errorData: { code: 'TRANSFER_IN_PROGRESS' },
          httpStatus: 409,
        }),
      ),
    ).toBe('deleteHistoryMigrating');
    expect(
      getDeleteErrorMessageKey(trpcError({ code: 'FORBIDDEN', errorData: { code: 'OWNER_ONLY' } })),
    ).toBe('deleteSharedOwnerOnly');
    expect(getDeleteErrorMessageKey(trpcError({ code: 'FORBIDDEN' }))).toBe('manageOnlyCreator');
    expect(getDeleteErrorMessageKey(new Error('boom'))).toBe('operationFailed');
  });
});
