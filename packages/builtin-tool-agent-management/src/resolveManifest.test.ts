import { describe, expect, it } from 'vitest';

import { AgentManagementManifest } from './manifest';
import { resolveAgentManagementManifest } from './resolveManifest';
import { AgentManagementApiName } from './types';

const apiNames = (manifest: { api: { name: string }[] }) => manifest.api.map((a) => a.name);

describe('resolveAgentManagementManifest', () => {
  it('returns the full static manifest in a normal (non-share) turn', () => {
    const result = resolveAgentManagementManifest({ scope: 'main' });

    expect(result).toBe(AgentManagementManifest);
    expect(apiNames(result!)).toContain(AgentManagementApiName.callAgent);
  });

  it('returns the full manifest when no context signals are set', () => {
    expect(resolveAgentManagementManifest({})).toBe(AgentManagementManifest);
  });

  it('hides callAgent in a share-visitor run regardless of scope', () => {
    // Agent share C3: callAgent dispatches through the same ctx.subAgent
    // runner as lobe-agent.callSubAgent — its child run has no shareGate of
    // its own, so it must be hidden from a share visitor the same way.
    const result = resolveAgentManagementManifest({ isShareVisitor: true, scope: 'main' })!;

    const names = apiNames(result);
    expect(names).not.toContain(AgentManagementApiName.callAgent);
    // the rest of agent-management stays available
    expect(names).toContain(AgentManagementApiName.createAgent);
    expect(names).toContain(AgentManagementApiName.searchAgent);
    expect(names).toHaveLength(AgentManagementManifest.api.length - 1);

    expect(result.identifier).toBe(AgentManagementManifest.identifier);
  });

  it('does not mutate the original static manifest', () => {
    const before = AgentManagementManifest.api.length;
    resolveAgentManagementManifest({ isShareVisitor: true });
    expect(AgentManagementManifest.api).toHaveLength(before);
    expect(apiNames(AgentManagementManifest)).toContain(AgentManagementApiName.callAgent);
  });
});
