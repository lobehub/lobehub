import { describe, expect, it } from 'vitest';

import {
  buildShareToolEntry,
  hasShareToolGrant,
  isShareToolApiGranted,
  parseShareToolEntry,
  resolveShareToolGrants,
} from './agentShare';

describe('parseShareToolEntry', () => {
  it('parses a bare toolset-level identifier', () => {
    expect(parseShareToolEntry('lobe-agent')).toEqual({ identifier: 'lobe-agent' });
  });

  it('parses a per-API scoped entry', () => {
    expect(parseShareToolEntry('lobe-agent____analyzeMedia')).toEqual({
      apiName: 'analyzeMedia',
      identifier: 'lobe-agent',
    });
  });

  it('rejects an entry with more than one separator', () => {
    expect(parseShareToolEntry('lobe-agent____analyzeMedia____extra')).toBeUndefined();
  });

  it('rejects an entry with an empty identifier or apiName segment', () => {
    expect(parseShareToolEntry('____analyzeMedia')).toBeUndefined();
    expect(parseShareToolEntry('lobe-agent____')).toBeUndefined();
  });

  it('rejects an empty entry', () => {
    expect(parseShareToolEntry('')).toBeUndefined();
  });
});

describe('buildShareToolEntry', () => {
  it('builds a bare identifier when no apiName is given', () => {
    expect(buildShareToolEntry('lobe-agent')).toBe('lobe-agent');
  });

  it('builds a per-API scoped entry', () => {
    expect(buildShareToolEntry('lobe-agent', 'analyzeMedia')).toBe('lobe-agent____analyzeMedia');
  });

  it('round-trips through parseShareToolEntry', () => {
    const entry = buildShareToolEntry('lobe-agent', 'analyzeMedia');
    expect(parseShareToolEntry(entry)).toEqual({
      apiName: 'analyzeMedia',
      identifier: 'lobe-agent',
    });
  });
});

describe('resolveShareToolGrants', () => {
  it('grants every API for a bare toolset-level entry', () => {
    const grants = resolveShareToolGrants(['lobe-agent']);
    expect(grants.get('lobe-agent')).toBe('all');
  });

  it('collects per-API entries into a Set', () => {
    const grants = resolveShareToolGrants([
      'lobe-agent____analyzeMedia',
      'lobe-agent____updatePlan',
    ]);
    expect(grants.get('lobe-agent')).toEqual(new Set(['analyzeMedia', 'updatePlan']));
  });

  it('lets a toolset-level entry win over per-API entries for the same identifier, regardless of order', () => {
    const before = resolveShareToolGrants(['lobe-agent', 'lobe-agent____analyzeMedia']);
    expect(before.get('lobe-agent')).toBe('all');

    const after = resolveShareToolGrants(['lobe-agent____analyzeMedia', 'lobe-agent']);
    expect(after.get('lobe-agent')).toBe('all');
  });

  it('ignores malformed entries', () => {
    const grants = resolveShareToolGrants(['lobe-agent____a____b', '____x', 'calculator']);
    expect(grants.has('lobe-agent')).toBe(false);
    expect(grants.get('calculator')).toBe('all');
  });

  it('tolerates an unset entries array', () => {
    expect(resolveShareToolGrants(undefined).size).toBe(0);
  });
});

describe('hasShareToolGrant / isShareToolApiGranted', () => {
  it('reports presence of any grant for an identifier', () => {
    const grants = resolveShareToolGrants(['lobe-agent____analyzeMedia']);
    expect(hasShareToolGrant(grants, 'lobe-agent')).toBe(true);
    expect(hasShareToolGrant(grants, 'calculator')).toBe(false);
  });

  it('checks per-API grants precisely', () => {
    const grants = resolveShareToolGrants(['lobe-agent____analyzeMedia']);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'analyzeMedia')).toBe(true);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'callSubAgent')).toBe(false);
  });

  it('a toolset-level grant covers every API', () => {
    const grants = resolveShareToolGrants(['lobe-agent']);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'anything')).toBe(true);
  });

  it('an ungranted identifier grants nothing', () => {
    const grants = resolveShareToolGrants([]);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'analyzeMedia')).toBe(false);
  });
});
