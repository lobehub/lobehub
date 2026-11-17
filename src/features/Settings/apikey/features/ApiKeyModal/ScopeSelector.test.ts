import { describe, expect, it } from 'vitest';

import { fromStoredScopes, toggleScopeSelection, toStoredScopes } from './ScopeSelector';

const sorted = (scopes: string[]) => [...scopes].sort();

describe('toggleScopeSelection', () => {
  it('adds the agent write and read scopes a credential write cannot work without', () => {
    expect(sorted(toggleScopeSelection([], 'agent:credential:write', true))).toEqual([
      'agent:credential:write',
      'agent:read',
      'agent:write',
    ]);
  });

  it('drops the credential write when the agent write or read it relies on is removed', () => {
    const granted = toggleScopeSelection(['chat:read'], 'agent:credential:write', true);

    expect(sorted(toggleScopeSelection(granted, 'agent:write', false))).toEqual([
      'agent:read',
      'chat:read',
    ]);
    expect(toggleScopeSelection(granted, 'agent:read', false)).toEqual(['chat:read']);
  });

  it('keeps write implying read, and a standalone scope standalone', () => {
    expect(sorted(toggleScopeSelection([], 'chat:write', true))).toEqual([
      'chat:read',
      'chat:write',
    ]);
    expect(toggleScopeSelection([], 'model:invoke', true)).toEqual(['model:invoke']);
    expect(toggleScopeSelection(['agent:read', 'agent:write'], 'agent:write', false)).toEqual([
      'agent:read',
    ]);
  });
});

describe('device:operate', () => {
  it('pulls device:read in with it, and goes when device:read goes', () => {
    const granted = toggleScopeSelection([], 'device:operate', true);

    expect(sorted(granted)).toEqual(['device:operate', 'device:read']);
    expect(toggleScopeSelection(granted, 'device:read', false)).toEqual([]);
  });

  it('is stored beside `*` when ticked with full access, and only then', () => {
    expect(toStoredScopes(true, [])).toEqual(['*']);
    expect(toStoredScopes(true, ['device:read', 'device:operate', 'chat:read'])).toEqual([
      '*',
      'device:operate',
    ]);
    expect(toStoredScopes(false, ['device:read'])).toEqual(['device:read']);
  });

  it('reads a stored list back into the editor state', () => {
    expect(fromStoredScopes(null)).toEqual({ fullAccess: true, selected: [] });
    expect(fromStoredScopes(['*', 'device:operate'])).toEqual({
      fullAccess: true,
      selected: ['device:operate'],
    });
    expect(fromStoredScopes(['device:read', 'chat:read'])).toEqual({
      fullAccess: false,
      selected: ['device:read', 'chat:read'],
    });
  });
});
