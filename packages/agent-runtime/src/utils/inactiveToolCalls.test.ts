import { describe, expect, it } from 'vitest';

import { buildInactiveToolContent, findInactiveToolIdentifier } from './inactiveToolCalls';

describe('findInactiveToolIdentifier', () => {
  const manifestMap = {
    'lobe-agent-management': { api: [{ name: 'createAgent' }] },
  };
  const offered = new Set(['lobe-activator____activateTools']);
  const none = new Set<string>();

  it('returns the identifier of a declared API on a tool that is not activated', () => {
    expect(
      findInactiveToolIdentifier(
        'lobe-agent-management____createAgent',
        manifestMap,
        offered,
        none,
      ),
    ).toBe('lobe-agent-management');
  });

  it('ignores a tool already activated in this operation', () => {
    expect(
      findInactiveToolIdentifier(
        'lobe-agent-management____createAgent',
        manifestMap,
        offered,
        new Set(['lobe-agent-management']),
      ),
    ).toBeUndefined();
  });

  it.each([
    ['a type-suffixed wire name', 'lobe-agent-management____createAgent____mcp'],
    ['a name without an API', 'lobe-agent-management'],
    ['an empty identifier', '____createAgent'],
    ['an undeclared API', 'lobe-agent-management____cloneAgent'],
    ['an identifier outside the manifest map', 'lobe-task____createTask'],
  ])('ignores %s', (_, name) => {
    expect(findInactiveToolIdentifier(name, manifestMap, offered, none)).toBeUndefined();
  });

  it('ignores every name when the activator is not offered', () => {
    expect(
      findInactiveToolIdentifier(
        'lobe-agent-management____createAgent',
        manifestMap,
        new Set(),
        none,
      ),
    ).toBeUndefined();
  });
});

describe('buildInactiveToolContent', () => {
  it('names every call and deduplicates the identifiers to activate', () => {
    expect(
      buildInactiveToolContent(
        ['lobe-agent-management____createAgent', 'lobe-agent-management____callAgent'],
        ['lobe-agent-management', 'lobe-agent-management'],
      ),
    ).toBe(
      'Tool call rejected: lobe-agent-management____createAgent, lobe-agent-management____callAgent are not activated in this run. Call lobe-activator____activateTools with identifiers ["lobe-agent-management"] first, then call it again.',
    );
  });
});
