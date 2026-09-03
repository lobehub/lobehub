import { describe, expect, it } from 'vitest';

import { hasShareToolGrant, isShareToolApiGranted, resolveShareToolGrants } from './agentShare';

describe('resolveShareToolGrants', () => {
  it('grants every API for a grant without `apis`', () => {
    const grants = resolveShareToolGrants([{ identifier: 'lobe-agent' }]);
    expect(grants.get('lobe-agent')).toBe('all');
  });

  it('collects the granted `apis` into a Set', () => {
    const grants = resolveShareToolGrants([
      { apis: ['analyzeMedia', 'updatePlan'], identifier: 'lobe-agent' },
    ]);
    expect(grants.get('lobe-agent')).toEqual(new Set(['analyzeMedia', 'updatePlan']));
  });

  it('lets a toolset-level grant win over a per-API one for the same identifier, regardless of order', () => {
    const before = resolveShareToolGrants([
      { identifier: 'lobe-agent' },
      { apis: ['analyzeMedia'], identifier: 'lobe-agent' },
    ]);
    expect(before.get('lobe-agent')).toBe('all');

    const after = resolveShareToolGrants([
      { apis: ['analyzeMedia'], identifier: 'lobe-agent' },
      { identifier: 'lobe-agent' },
    ]);
    expect(after.get('lobe-agent')).toBe('all');
  });

  it('unions two per-API grants for the same identifier', () => {
    const grants = resolveShareToolGrants([
      { apis: ['analyzeMedia'], identifier: 'lobe-agent' },
      { apis: ['updatePlan'], identifier: 'lobe-agent' },
    ]);
    expect(grants.get('lobe-agent')).toEqual(new Set(['analyzeMedia', 'updatePlan']));
  });

  it('reads an explicit empty `apis` array fail-closed as no grant, never as a toolset-level grant', () => {
    const grants = resolveShareToolGrants([{ apis: [], identifier: 'calculator' }]);

    expect(grants.has('calculator')).toBe(false);
  });

  it('ignores an entry with an empty identifier', () => {
    const grants = resolveShareToolGrants([{ identifier: '' }, { identifier: 'calculator' }]);
    expect(grants.has('')).toBe(false);
    expect(grants.get('calculator')).toBe('all');
  });

  it('tolerates an unset grants array', () => {
    expect(resolveShareToolGrants(undefined).size).toBe(0);
  });
});

describe('hasShareToolGrant / isShareToolApiGranted', () => {
  it('reports presence of any grant for an identifier', () => {
    const grants = resolveShareToolGrants([{ apis: ['analyzeMedia'], identifier: 'lobe-agent' }]);
    expect(hasShareToolGrant(grants, 'lobe-agent')).toBe(true);
    expect(hasShareToolGrant(grants, 'calculator')).toBe(false);
  });

  it('checks per-API grants precisely', () => {
    const grants = resolveShareToolGrants([{ apis: ['analyzeMedia'], identifier: 'lobe-agent' }]);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'analyzeMedia')).toBe(true);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'callSubAgent')).toBe(false);
  });

  it('a toolset-level grant covers every API', () => {
    const grants = resolveShareToolGrants([{ identifier: 'lobe-agent' }]);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'anything')).toBe(true);
  });

  it('an ungranted identifier grants nothing', () => {
    const grants = resolveShareToolGrants([]);
    expect(isShareToolApiGranted(grants, 'lobe-agent', 'analyzeMedia')).toBe(false);
  });
});
