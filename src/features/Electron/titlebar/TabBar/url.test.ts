import { describe, expect, it } from 'vitest';

import { normalizeTabUrl, parseAgentTabContext } from './url';

describe('normalizeTabUrl', () => {
  it('keeps a plain pathname', () => {
    expect(normalizeTabUrl('/agent/abc')).toBe('/agent/abc');
  });

  it('strips a trailing slash', () => {
    expect(normalizeTabUrl('/agent/abc/')).toBe('/agent/abc');
  });

  it('keeps the root path intact', () => {
    expect(normalizeTabUrl('/')).toBe('/');
  });

  it('normalizes search param ordering', () => {
    expect(normalizeTabUrl('/agent/abc?b=2&a=1')).toBe('/agent/abc?a=1&b=2');
  });

  it('keeps all search params (identity-significant)', () => {
    expect(normalizeTabUrl('/group/g1?topic=t1')).toBe('/group/g1?topic=t1');
  });

  it('drops the hash fragment', () => {
    expect(normalizeTabUrl('/agent/abc?a=1#section')).toBe('/agent/abc?a=1');
  });

  it('makes equivalent URLs collapse to the same id', () => {
    expect(normalizeTabUrl('/agent/abc?a=1&b=2')).toBe(normalizeTabUrl('/agent/abc?b=2&a=1'));
  });
});

describe('parseAgentTabContext', () => {
  it('parses a bare agent url', () => {
    expect(parseAgentTabContext('/agent/abc')).toEqual({ agentId: 'abc', topicId: null });
  });

  it('parses an agent topic path url', () => {
    expect(parseAgentTabContext('/agent/abc/tpc_xyz')).toEqual({
      agentId: 'abc',
      topicId: 'tpc_xyz',
    });
  });

  it('parses topic from the search param', () => {
    expect(parseAgentTabContext('/agent/abc?topic=t1')).toEqual({
      agentId: 'abc',
      topicId: 't1',
    });
  });

  it('returns null for non-agent urls', () => {
    expect(parseAgentTabContext('/group/g1')).toBeNull();
  });
});
