import { type UserCredSummary } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { filterVault, matchesVaultKeyword } from './vaultFilter';

const cred = (patch: Partial<UserCredSummary>): UserCredSummary => ({
  createdAt: '2026-11-01T00:00:00Z',
  id: 1,
  key: 'key',
  name: 'name',
  type: 'kv-env',
  updatedAt: '2026-11-01T00:00:00Z',
  ...patch,
});

const vault = [
  cred({ id: 1, key: 'OPENAI_API_KEY', name: 'OpenAI', type: 'kv-env' }),
  cred({ id: 2, key: 'notion', name: 'Notion token', type: 'kv-header' }),
  cred({
    id: 3,
    key: 'github',
    name: 'github.com',
    oauthUsername: 'canisminor1990',
    type: 'oauth',
  }),
  cred({ fileName: 'service-account.json', id: 4, key: 'gcp', name: 'GCP', type: 'file' }),
];

describe('matchesVaultKeyword', () => {
  it('matches every remembered field, case-insensitively', () => {
    expect(matchesVaultKeyword(vault[0], 'openai_api')).toBe(true);
    expect(matchesVaultKeyword(vault[2], 'CANISMINOR')).toBe(true);
    expect(matchesVaultKeyword(vault[3], 'service-account')).toBe(true);
    expect(matchesVaultKeyword(vault[0], 'notion')).toBe(false);
  });

  it('treats a blank keyword as no filter', () => {
    expect(matchesVaultKeyword(vault[1], '   ')).toBe(true);
  });
});

describe('filterVault', () => {
  it('counts every category and keeps all items under "all"', () => {
    const { counts, items } = filterVault(vault, { category: 'all', keyword: '' });

    expect(items).toHaveLength(4);
    expect(counts).toEqual({ 'all': 4, 'file': 1, 'kv-env': 1, 'kv-header': 1, 'oauth': 1 });
  });

  it('narrows to one category', () => {
    const { items } = filterVault(vault, { category: 'oauth', keyword: '' });

    expect(items.map((c) => c.id)).toEqual([3]);
  });

  it('counts what the keyword leaves, so a tab tells how many results it shows', () => {
    const { counts, items } = filterVault(vault, { category: 'kv-header', keyword: 'no' });

    // "no" matches Notion and the GitHub account (canisminor…) only.
    expect(counts).toEqual({ 'all': 2, 'file': 0, 'kv-env': 0, 'kv-header': 1, 'oauth': 1 });
    expect(items.map((c) => c.id)).toEqual([2]);
  });
});
