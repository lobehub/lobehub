import { describe, expect, it } from 'vitest';

import { isSkillConnectionError } from './skillConnectionError';

const trpcError = (code: string, errorCode?: string) => ({
  data: { code, errorData: errorCode ? { code: errorCode } : undefined },
});

describe('isSkillConnectionError', () => {
  it.each(['NOT_CONNECTED', 'TOKEN_EXPIRED'])('accepts PRECONDITION_FAILED + %s', (code) => {
    expect(isSkillConnectionError(trpcError('PRECONDITION_FAILED', code))).toBe(true);
  });

  it.each([
    ['plain UNAUTHORIZED', trpcError('UNAUTHORIZED')],
    ['UNAUTHORIZED carrying a connection code', trpcError('UNAUTHORIZED', 'NOT_CONNECTED')],
    ['PRECONDITION_FAILED without errorData', trpcError('PRECONDITION_FAILED')],
    ['PRECONDITION_FAILED with another code', trpcError('PRECONDITION_FAILED', 'OTHER')],
    ['error without data', new Error('NOT_CONNECTED')],
    ['null', null],
  ])('rejects %s', (_name, error) => {
    expect(isSkillConnectionError(error)).toBe(false);
  });
});
