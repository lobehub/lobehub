import { describe, expect, it } from 'vitest';

import { isUnauthorizedTRPCError } from './serverTrpc';

describe('isUnauthorizedTRPCError', () => {
  it('recognizes the serialized TRPC unauthorized shape', () => {
    expect(isUnauthorizedTRPCError({ data: { code: 'UNAUTHORIZED' } })).toBe(true);
  });

  it.each([
    new Error('network failed'),
    { data: { code: 'INTERNAL_SERVER_ERROR' } },
    { data: null },
    null,
  ])('keeps unexpected SSR failures visible', (error) => {
    expect(isUnauthorizedTRPCError(error)).toBe(false);
  });
});
