import { describe, expect, it } from 'vitest';

import { toggleScopeSelection } from './ScopeSelector';

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
