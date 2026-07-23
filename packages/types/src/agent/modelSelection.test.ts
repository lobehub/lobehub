import { describe, expect, it } from 'vitest';

import { resolveAgentModelConfig, resolveAgentModelSelectionPolicy } from './modelSelection';

const shared = {
  model: 'shared-model',
  provider: 'shared-provider',
};
const workspaceShared = {
  ...shared,
  visibility: 'public' as const,
  workspaceId: 'workspace-1',
};

describe('resolveAgentModelSelectionPolicy', () => {
  it('defaults a legacy public Workspace Agent to member selection', () => {
    expect(resolveAgentModelSelectionPolicy(workspaceShared)).toBe('member');
  });

  it('keeps personal and private Agents fixed when the policy is missing', () => {
    expect(resolveAgentModelSelectionPolicy({ workspaceId: null })).toBe('fixed');
    expect(resolveAgentModelSelectionPolicy({ ...workspaceShared, visibility: 'private' })).toBe(
      'fixed',
    );
  });

  it('preserves an explicit fixed policy for a public Workspace Agent', () => {
    expect(
      resolveAgentModelSelectionPolicy({
        ...workspaceShared,
        agencyConfig: { modelSelectionPolicy: 'fixed' },
      }),
    ).toBe('fixed');
  });
});

describe('resolveAgentModelConfig', () => {
  it('uses a member override for a legacy public Workspace Agent', () => {
    expect(
      resolveAgentModelConfig(workspaceShared, {
        model: 'member-model',
        provider: 'member-provider',
      }),
    ).toEqual({ model: 'member-model', provider: 'member-provider' });
  });

  it('ignores a retained member override while the policy is fixed', () => {
    expect(
      resolveAgentModelConfig(
        { ...workspaceShared, agencyConfig: { modelSelectionPolicy: 'fixed' } },
        { model: 'member-model', provider: 'member-provider' },
      ),
    ).toEqual({ model: 'shared-model', provider: 'shared-provider' });
  });

  it('uses the member override when the author allows member selection', () => {
    expect(
      resolveAgentModelConfig(
        { ...workspaceShared, agencyConfig: { modelSelectionPolicy: 'member' } },
        { model: 'member-model', provider: 'member-provider' },
      ),
    ).toEqual({ model: 'member-model', provider: 'member-provider' });
  });

  it('ignores member overrides for an author or Workspace admin', () => {
    expect(
      resolveAgentModelConfig(
        {
          ...workspaceShared,
          agencyConfig: { modelSelectionPolicy: 'member' },
          canManage: true,
        },
        { model: 'member-model', provider: 'member-provider' },
      ),
    ).toEqual({ model: 'shared-model', provider: 'shared-provider' });
  });

  it('ignores the member override while the workspace Agent is private', () => {
    expect(
      resolveAgentModelConfig(
        {
          ...shared,
          agencyConfig: { modelSelectionPolicy: 'member' },
          visibility: 'private',
          workspaceId: 'workspace-1',
        },
        { model: 'member-model', provider: 'member-provider' },
      ),
    ).toEqual({ model: 'shared-model', provider: 'shared-provider' });
  });

  it('keeps the shared model when member selection is enabled but no choice was saved', () => {
    expect(
      resolveAgentModelConfig({
        ...shared,
        agencyConfig: { modelSelectionPolicy: 'member' },
        visibility: 'public',
        workspaceId: 'workspace-1',
      }),
    ).toEqual({ model: 'shared-model', provider: 'shared-provider' });
  });

  it('applies explicit per-run overrides after the member choice', () => {
    expect(
      resolveAgentModelConfig(
        { ...workspaceShared, agencyConfig: { modelSelectionPolicy: 'member' } },
        { model: 'member-model', provider: 'member-provider' },
        { model: 'run-model' },
      ),
    ).toEqual({ model: 'run-model', provider: 'member-provider' });
  });
});
