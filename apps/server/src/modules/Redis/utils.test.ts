import { describe, expect, it } from 'vitest';

import {
  buildIORedisSetArgs,
  normalizeMsetValues,
  normalizeRedisKey,
  normalizeRedisKeys,
} from './utils';

describe('redis utils', () => {
  it('normalizes single redis key to string', () => {
    expect(normalizeRedisKey('foo')).toBe('foo');
    expect(normalizeRedisKey(Buffer.from('bar'))).toBe('bar');
  });

  it('normalizes an array of redis keys', () => {
    expect(normalizeRedisKeys(['foo', Buffer.from('bar')])).toEqual(['foo', 'bar']);
  });

  it('normalizes mset values from Map', () => {
    const payload = normalizeMsetValues(
      new Map<Buffer | string, number>([
        [Buffer.from('a'), 1],
        ['b', 2],
      ]),
    );

    expect(payload).toEqual({ a: 1, b: 2 });
  });

  it('builds ioredis set arguments', () => {
    const args = buildIORedisSetArgs({ ex: 1, nx: true, get: true });

    expect(args).toEqual(['EX', 1, 'NX', 'GET']);
  });
});
