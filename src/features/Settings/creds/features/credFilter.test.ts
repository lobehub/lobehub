import { describe, expect, it } from 'vitest';

import { countCredsByType, filterCreds, isCredFilterActive } from './credFilter';

const creds = [
  { description: 'Used by the coder agent', key: 'openai', name: 'OpenAI API Key', type: 'kv-env' },
  { description: undefined, key: 'github', name: 'GitHub (me)', type: 'oauth' },
  { description: 'GCP service account', key: 'gcp-sa', name: 'GCP', type: 'file' },
] as const;

describe('filterCreds', () => {
  it('returns every row without a filter', () => {
    expect(filterCreds([...creds], {})).toHaveLength(3);
    expect(filterCreds([...creds], { keyword: '  ', type: 'all' })).toHaveLength(3);
  });

  it('matches the keyword against name and description, ignoring case', () => {
    expect(filterCreds([...creds], { keyword: 'OPENAI' }).map((c) => c.key)).toEqual(['openai']);
    expect(filterCreds([...creds], { keyword: 'coder' }).map((c) => c.key)).toEqual(['openai']);
  });

  it('does not match the hidden key', () => {
    expect(filterCreds([...creds], { keyword: 'gcp-sa' })).toEqual([]);
  });

  it('narrows by type and combines with the keyword', () => {
    expect(filterCreds([...creds], { type: 'oauth' }).map((c) => c.key)).toEqual(['github']);
    expect(filterCreds([...creds], { keyword: 'openai', type: 'file' })).toEqual([]);
  });
});

describe('isCredFilterActive', () => {
  it('is active only when a keyword or a specific type is set', () => {
    expect(isCredFilterActive({})).toBe(false);
    expect(isCredFilterActive({ keyword: ' ', type: 'all' })).toBe(false);
    expect(isCredFilterActive({ keyword: 'a' })).toBe(true);
    expect(isCredFilterActive({ type: 'file' })).toBe(true);
  });
});

describe('countCredsByType', () => {
  it('counts every type, including empty ones, after the keyword', () => {
    expect(countCredsByType([...creds])).toEqual({
      'all': 3,
      'file': 1,
      'kv-env': 1,
      'kv-header': 0,
      'oauth': 1,
    });
    expect(countCredsByType([...creds], 'gcp')).toEqual({
      'all': 1,
      'file': 1,
      'kv-env': 0,
      'kv-header': 0,
      'oauth': 0,
    });
  });
});
