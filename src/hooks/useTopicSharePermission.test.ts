import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicSharePermission } from './useTopicSharePermission';

const mocks = vi.hoisted(() => ({
  agentMap: {} as Record<string, object>,
  permissions: {
    edit_others_content: { allowed: false, reason: 'requires owner' },
    edit_own_content: { allowed: true, reason: undefined as string | undefined },
  } as Record<string, { allowed: boolean; reason?: string }>,
  userId: 'member' as string | undefined,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: string) => mocks.permissions[action],
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({ agentMap: mocks.agentMap }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({ user: { id: mocks.userId } }),
}));

const restrictedAgent = {
  agencyConfig: { topicSharePolicy: 'restricted' },
  userId: 'author',
  workspaceId: 'workspace-1',
};

const setup = (agentId?: string) => renderHook(() => useTopicSharePermission(agentId));

describe('useTopicSharePermission', () => {
  beforeEach(() => {
    mocks.permissions = {
      edit_others_content: { allowed: false, reason: 'requires owner' },
      edit_own_content: { allowed: true, reason: undefined },
    };
    mocks.userId = 'member';
    mocks.agentMap = { 'agent-1': restrictedAgent };
  });

  it('reports the role gate verbatim when the role itself blocks sharing', () => {
    // A viewer has to hear "your role can't do this", not the agent's policy.
    mocks.permissions.edit_own_content = { allowed: false, reason: 'requires member' };

    const { result } = setup('agent-1');

    expect(result.current).toEqual({ allowed: false, reason: 'requires member' });
  });

  it('blocks a member on a restricted agent and says who to ask', () => {
    const { result } = setup('agent-1');

    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe('workspace.permission.topicShareRestricted');
  });

  it('lets the agent author through', () => {
    mocks.userId = 'author';

    expect(setup('agent-1').result.current.allowed).toBe(true);
  });

  it('lets a workspace owner through', () => {
    mocks.permissions.edit_others_content = { allowed: true };

    expect(setup('agent-1').result.current.allowed).toBe(true);
  });

  it('allows sharing while the agent row is still absent from the store', () => {
    // The server refuses the write either way; enabling a beat early beats a
    // control that claims to be blocked and then isn't.
    expect(setup('agent-missing').result.current.allowed).toBe(true);
    expect(setup(undefined).result.current.allowed).toBe(true);
  });

  it('leaves personal and default-policy agents unrestricted', () => {
    mocks.agentMap = {
      'agent-personal': { ...restrictedAgent, workspaceId: null },
      'agent-default': { agencyConfig: {}, userId: 'author', workspaceId: 'workspace-1' },
    };

    expect(setup('agent-personal').result.current.allowed).toBe(true);
    expect(setup('agent-default').result.current.allowed).toBe(true);
  });
});
