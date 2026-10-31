import { describe, expect, it } from 'vitest';

import {
  isDocumentCommentsUnavailable,
  isDocumentUnavailableError,
  resolveDocumentSectionState,
} from './isDocumentUnavailableError';

const trpcError = (code: string) => Object.assign(new Error(code), { data: { code } });

describe('isDocumentUnavailableError', () => {
  it('matches a page this member may not open or that no longer exists', () => {
    expect(isDocumentUnavailableError(trpcError('FORBIDDEN'))).toBe(true);
    expect(isDocumentUnavailableError(trpcError('NOT_FOUND'))).toBe(true);
  });

  it('leaves transient failures to their own retryable error state', () => {
    expect(isDocumentUnavailableError(trpcError('INTERNAL_SERVER_ERROR'))).toBe(false);
    expect(isDocumentUnavailableError(new Error('network'))).toBe(false);
    expect(isDocumentUnavailableError(undefined)).toBe(false);
  });
});

describe('resolveDocumentSectionState', () => {
  const cached = { total: 3 };

  it('hides cached data once the page went private or is gone', () => {
    // SWR keeps the last data next to the revalidation error.
    expect(resolveDocumentSectionState(cached, trpcError('FORBIDDEN'))).toBe('hidden');
    expect(resolveDocumentSectionState(cached, trpcError('NOT_FOUND'))).toBe('hidden');
    expect(resolveDocumentSectionState(undefined, trpcError('FORBIDDEN'))).toBe('hidden');
  });

  it('shows a retryable error only for a transient initial failure', () => {
    expect(resolveDocumentSectionState(undefined, trpcError('INTERNAL_SERVER_ERROR'))).toBe(
      'error',
    );
    expect(resolveDocumentSectionState(cached, trpcError('INTERNAL_SERVER_ERROR'))).toBe('ready');
    expect(resolveDocumentSectionState(cached, undefined)).toBe('ready');
  });
});

describe('isDocumentCommentsUnavailable', () => {
  it('drops comments when either thread list sees the page closed or gone', () => {
    expect(
      isDocumentCommentsUnavailable({ documentThreads: { error: trpcError('FORBIDDEN') } }),
    ).toBe(true);
    expect(
      isDocumentCommentsUnavailable({
        anchoredError: trpcError('NOT_FOUND'),
        documentThreads: {},
      }),
    ).toBe(true);
  });

  it('keeps comments on a transient failure', () => {
    expect(
      isDocumentCommentsUnavailable({
        anchoredError: new Error('network'),
        documentThreads: { error: trpcError('INTERNAL_SERVER_ERROR') },
      }),
    ).toBe(false);
  });
});
