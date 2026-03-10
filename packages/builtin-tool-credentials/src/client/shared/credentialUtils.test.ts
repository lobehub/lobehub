import { describe, expect, it } from 'vitest';

import {
  deleteAtPath,
  filterCredentialItems,
  flattenStringLeaves,
  isValidPath,
  maskValue,
  normalizePath,
  setValueAtPath,
} from './credentialUtils';

describe('credentialUtils', () => {
  it('normalizePath should trim and collapse dots', () => {
    expect(normalizePath('  .moltbook..apiKey. ')).toBe('moltbook.apiKey');
  });

  it('isValidPath should validate allowed dot-path format', () => {
    expect(isValidPath('moltbook.apiKey')).toBe(true);
    expect(isValidPath('sandboxEnv.MOLTBOOK_API_KEY')).toBe(true);
    expect(isValidPath('moltbook..apiKey')).toBe(false);
    expect(isValidPath('moltbook apiKey')).toBe(false);
  });

  it('flattenStringLeaves should flatten only string leaves', () => {
    const result = flattenStringLeaves({
      github: { token: 'gh_xxx' },
      moltbook: { apiKey: 'mb_xxx', nested: { enabled: true } },
      number: 1,
    } as any);

    expect(result).toEqual(
      expect.arrayContaining([
        { path: 'github.token', value: 'gh_xxx' },
        { path: 'moltbook.apiKey', value: 'mb_xxx' },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('setValueAtPath should set nested value', () => {
    const keyVaults: Record<string, any> = {};
    setValueAtPath(keyVaults, 'moltbook.apiKey', 'token_123');

    expect(keyVaults).toEqual({ moltbook: { apiKey: 'token_123' } });
  });

  it('deleteAtPath should delete leaf and cleanup empty parents', () => {
    const keyVaults: Record<string, any> = {
      moltbook: { apiKey: 'token', baseURL: 'https://example.com' },
      github: { token: 'gh' },
    };

    expect(deleteAtPath(keyVaults, 'github.token')).toBe(true);
    expect(keyVaults.github).toBeUndefined();

    expect(deleteAtPath(keyVaults, 'moltbook.apiKey')).toBe(true);
    expect(keyVaults.moltbook).toEqual({ baseURL: 'https://example.com' });
  });

  it('maskValue should mask plaintext value', () => {
    expect(maskValue('abcd1234')).toBe('ab****34');
    expect(maskValue('abc')).toBe('***');
  });

  it('filterCredentialItems should apply prefix matching', () => {
    const items = [
      { path: 'moltbook.apiKey', value: 'a' },
      { path: 'moltbook.baseURL', value: 'b' },
      { path: 'github.token', value: 'c' },
    ];

    expect(filterCredentialItems(items, 'moltbook')).toEqual([
      { path: 'moltbook.apiKey', value: 'a' },
      { path: 'moltbook.baseURL', value: 'b' },
    ]);
  });
});
