import { describe, expect, it } from 'vitest';

import {
  connectorIdentifierCandidates,
  connectorToolIdentifier,
  manifestBaseIdentifier,
} from './connectorToolIdentifier';

const id = '3f9a1c2e-0000-4000-8000-000000000001';

describe('connectorToolIdentifier', () => {
  it('keeps the identifier for a shared row, an agent row and a personal run', () => {
    expect(connectorToolIdentifier({ id, identifier: 'github', visibility: 'public' }, 'ws')).toBe(
      'github',
    );
    expect(
      connectorToolIdentifier(
        { agentId: 'agt', id, identifier: 'github', visibility: 'private' },
        'ws',
      ),
    ).toBe('github');
    expect(connectorToolIdentifier({ id, identifier: 'github', workspaceId: null })).toBe('github');
  });

  it('takes the whole row id when a row the run sees is literally named like its prefix', () => {
    // A shared connector literally named `github-3f9a1c2e` beside a private
    // `github` whose id starts so: the two must never share a prefix
    expect(
      connectorToolIdentifier(
        { id, identifier: 'github', visibility: 'private' },
        'ws',
        new Set(['github', 'github-3f9a1c2e']),
      ),
    ).toBe('github-3f9a1c2e000040008000000000000001');
    expect(connectorIdentifierCandidates('github-3f9a1c2e000040008000000000000001')).toEqual([
      'github-3f9a1c2e000040008000000000000001',
      'github',
    ]);
  });

  it("suffixes a private row, and a personal row in a workspace run, with the row's id", () => {
    expect(connectorToolIdentifier({ id, identifier: 'github', visibility: 'private' }, 'ws')).toBe(
      'github-3f9a1c2e',
    );
    expect(
      connectorToolIdentifier(
        { id, identifier: 'github', visibility: 'public', workspaceId: null },
        'ws',
      ),
    ).toBe('github-3f9a1c2e');
  });
});

describe('connectorIdentifierCandidates', () => {
  it('names itself, and the base a row suffix points to', () => {
    expect(connectorIdentifierCandidates('github')).toEqual(['github']);
    expect(connectorIdentifierCandidates('github-3f9a1c2e')).toEqual(['github-3f9a1c2e', 'github']);
    expect(connectorIdentifierCandidates('my-mcp')).toEqual(['my-mcp']);
  });
});

describe('manifestBaseIdentifier', () => {
  it("reads a connector row's base identifier, else the manifest's own", () => {
    expect(
      manifestBaseIdentifier({
        connector: { identifier: 'github' },
        identifier: 'github-3f9a1c2e',
      }),
    ).toBe('github');
    expect(manifestBaseIdentifier({ identifier: 'lobe-web-browsing' })).toBe('lobe-web-browsing');
  });
});
