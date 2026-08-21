import { describe, expect, it } from 'vitest';

import { resolveClearedAgencyConfig, retainAgentPermissionPolicies } from './agent-policy-keys';

describe('retainAgentPermissionPolicies', () => {
  it('keeps the member permission policies when an unauthorized caller clears', () => {
    // A workspace Admin holds `AGENT_UPDATE:all` and can clear anyone's agent
    // config here, but writing these keys is the creator's and the workspace
    // owner's alone — a clear must not become a way around that. (The caller
    // side decides: an authorized creator or primary owner never reaches here
    // and clears the column outright.)
    expect(
      retainAgentPermissionPolicies({
        boundDeviceId: 'device-1',
        executionTargetSelectionPolicy: 'fixed',
        graph: { nodes: [] },
        modelSelectionPolicy: 'fixed',
        topicSharePolicy: 'restricted',
      }),
    ).toEqual({
      executionTargetSelectionPolicy: 'fixed',
      modelSelectionPolicy: 'fixed',
      topicSharePolicy: 'restricted',
    });
  });

  it('drops everything the schema could have set', () => {
    expect(retainAgentPermissionPolicies({ graph: { nodes: [] } })).toBeNull();
  });

  it('clears the column outright when no policy was ever stored', () => {
    expect(retainAgentPermissionPolicies(null)).toBeNull();
    expect(retainAgentPermissionPolicies(undefined)).toBeNull();
    expect(retainAgentPermissionPolicies({})).toBeNull();
  });

  it('keeps a policy explicitly stored as the permissive default', () => {
    // `member` is the resolved default, but an author who set it deliberately
    // should not have it erased either — the caller cannot express it.
    expect(retainAgentPermissionPolicies({ topicSharePolicy: 'member' })).toEqual({
      topicSharePolicy: 'member',
    });
  });
});

describe('resolveClearedAgencyConfig', () => {
  const stored = { graph: { nodes: [] }, topicSharePolicy: 'restricted' };

  it('clears outright for the agent creator or workspace primary owner', () => {
    // They are exactly who `updateAgentConfig` lets write these keys, so the
    // clear they asked for has to actually happen — including resetting a
    // `restricted` policy back to the default.
    expect(resolveClearedAgencyConfig(stored, true)).toBeNull();
  });

  it('keeps the policies for anyone else, such as a workspace Admin', () => {
    expect(resolveClearedAgencyConfig(stored, false)).toEqual({
      topicSharePolicy: 'restricted',
    });
  });
});
