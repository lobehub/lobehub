import { describe, expect, it } from 'vitest';

import { AgentManagementManifest } from './manifest';
import { resolveAgentManagementManifest } from './resolveManifest';

describe('resolveAgentManagementManifest', () => {
  it('returns the full static manifest in a normal (non-share) turn', () => {
    const result = resolveAgentManagementManifest({ scope: 'main' });

    expect(result).toBe(AgentManagementManifest);
  });

  it('returns the full manifest when no context signals are set', () => {
    expect(resolveAgentManagementManifest({})).toBe(AgentManagementManifest);
  });

  it('hides the ENTIRE tool for a share-visitor run, not just callAgent', () => {
    // A share visitor must not be offered createAgent/updateAgent/searchAgent/
    // getAgentDetail/duplicateAgent/installPlugin/updatePrompt either — every
    // API in this manifest operates against the creator's private agent
    // collection with a visitor-suppliable `agentId`, none of them are scoped
    // to the shared agent itself. Returning `null` removes the tool from the
    // ToolsEngine entirely (see `createServerToolsEngine`), not just its
    // dispatch API.
    expect(resolveAgentManagementManifest({ isShareVisitor: true })).toBeNull();
    expect(resolveAgentManagementManifest({ isShareVisitor: true, scope: 'main' })).toBeNull();
  });

  it('does not mutate the original static manifest', () => {
    const before = AgentManagementManifest.api.length;
    resolveAgentManagementManifest({ isShareVisitor: true });
    expect(AgentManagementManifest.api).toHaveLength(before);
  });
});
