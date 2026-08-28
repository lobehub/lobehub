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

  it('drops the hash fragment when there is no search string', () => {
    expect(normalizeTabUrl('/settings/agent#llm')).toBe('/settings/agent');
  });

  it('treats two anchors of the same page as one tab identity', () => {
    expect(normalizeTabUrl('/agent/abc#msg_1')).toBe(normalizeTabUrl('/agent/abc#msg_2'));
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

  it('parses a workspace agent url', () => {
    expect(parseAgentTabContext('/acme/agent/abc')).toEqual({
      agentId: 'abc',
      topicId: null,
      workspaceSlug: 'acme',
    });
  });

  it('parses a workspace agent topic path url', () => {
    expect(parseAgentTabContext('/acme/agent/abc/tpc_xyz')).toEqual({
      agentId: 'abc',
      topicId: 'tpc_xyz',
      workspaceSlug: 'acme',
    });
  });

  it('parses workspace topic from the search param', () => {
    expect(parseAgentTabContext('/acme/agent/abc?topic=t1')).toEqual({
      agentId: 'abc',
      topicId: 't1',
      workspaceSlug: 'acme',
    });
  });

  it('ignores the hash fragment when reading the agent id', () => {
    expect(parseAgentTabContext('/agent/abc#msg_1')).toEqual({ agentId: 'abc', topicId: null });
  });

  it('returns null for non-agent urls', () => {
    expect(parseAgentTabContext('/group/g1')).toBeNull();
  });
});
