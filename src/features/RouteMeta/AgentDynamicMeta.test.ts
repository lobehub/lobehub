import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

import AgentDynamicMeta, { ProfileDynamicMeta } from './AgentDynamicMeta';

vi.mock('./workspaceScope', () => ({
  matchesRouteWorkspace: () => true,
  useRouteWorkspaceId: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('AgentDynamicMeta avatar identity', () => {
  beforeEach(() => {
    useAgentStore.setState({ agentMap: {} });
  });

  it('marks an agent without an avatar so the tab draws its generated character', () => {
    useAgentStore.setState({ agentMap: { 'agent-1': { title: 'Mail' } as any } });
    const onResolve = vi.fn();

    renderHook(() => AgentDynamicMeta({ onResolve, params: { aid: 'agent-1' } }));

    expect(onResolve).toHaveBeenLastCalledWith(
      expect.objectContaining({
        avatar: null,
        avatarKind: 'agent',
        avatarSeed: 'agent-1',
      }),
    );
  });

  it('publishes the identity before the agent has loaded', () => {
    const onResolve = vi.fn();

    renderHook(() => AgentDynamicMeta({ onResolve, params: { aid: 'agent-1' } }));

    expect(onResolve).toHaveBeenLastCalledWith(
      expect.objectContaining({ avatarKind: 'agent', avatarSeed: 'agent-1' }),
    );
  });

  it('marks agent sub-pages too', () => {
    const onResolve = vi.fn();

    renderHook(() => ProfileDynamicMeta({ onResolve, params: { aid: 'agent-1' } }));

    expect(onResolve).toHaveBeenLastCalledWith(
      expect.objectContaining({ avatarKind: 'agent', avatarSeed: 'agent-1' }),
    );
  });
});
