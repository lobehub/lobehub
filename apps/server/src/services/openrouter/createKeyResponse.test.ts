import { describe, expect, it } from 'vitest';

import { parseCreateKeyResponse } from './createKeyResponse';

describe('parseCreateKeyResponse', () => {
  it('reads top-level key from the real OpenRouter create response shape', () => {
    const parsed = parseCreateKeyResponse({
      data: {
        disabled: false,
        hash: 'abc123',
        limit: 5,
        limit_remaining: 5,
        name: 'cust',
        usage: 0,
      },
      key: 'sk-or-v1-real',
    });

    expect(parsed.key).toBe('sk-or-v1-real');
    expect(parsed.hash).toBe('abc123');
    expect(parsed.limit).toBe(5);
    expect(parsed.limitRemaining).toBe(5);
  });

  it('falls back to nested data.key for older shapes', () => {
    const parsed = parseCreateKeyResponse({
      data: {
        disabled: false,
        hash: 'nested',
        key: 'sk-or-v1-nested',
        limit: 1,
        limit_remaining: 1,
        name: 'cust',
        usage: 0,
      },
    });

    expect(parsed.key).toBe('sk-or-v1-nested');
    expect(parsed.hash).toBe('nested');
  });

  it('throws when plaintext key is missing', () => {
    expect(() =>
      parseCreateKeyResponse({
        data: {
          disabled: false,
          hash: 'no-key',
          limit: 1,
          limit_remaining: 1,
          name: 'cust',
          usage: 0,
        },
      }),
    ).toThrow(/createKey response missing key/);
  });
});
