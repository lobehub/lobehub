import { describe, expect, it } from 'vitest';

import { isExpectedShareAccessTRPCError } from './serverTrpc';

describe('isExpectedShareAccessTRPCError', () => {
  it.each(['FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED'])(
    'recognizes the serialized TRPC %s shape',
    (code) => {
      expect(isExpectedShareAccessTRPCError({ data: { code } })).toBe(true);
    },
  );

  it('does not accept partial code matches', () => {
    expect(isExpectedShareAccessTRPCError({ data: { code: 'FS_NOT_FOUND' } })).toBe(false);
  });

  it.each([
    new Error('network failed'),
    { data: { code: 'INTERNAL_SERVER_ERROR' } },
    { data: null },
    null,
  ])('keeps unexpected SSR failures visible', (error) => {
    expect(isExpectedShareAccessTRPCError(error)).toBe(false);
  });
});
