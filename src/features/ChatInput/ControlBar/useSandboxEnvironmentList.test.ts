import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useIsSharedAgent,
  useProjectSandboxEnvironments,
  useSandboxEnvironmentList,
} from './useSandboxEnvironmentList';

const state = vi.hoisted(() => ({
  fetchEnvironments: vi.fn(),
  listEnvironments: vi.fn(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'workspace-1',
}));
// The active agent is private; the conversation's own agent is workspace-public.
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) =>
    selector({
      activeAgentId: 'agent-private',
      agentMap: {
        'agent-private': { visibility: 'private' },
        'agent-public': { visibility: 'public' },
      },
    }),
}));
vi.mock('@/services/environment', () => ({
  environmentService: { listEnvironments: state.listEnvironments },
}));

const PROJECT_ENVIRONMENTS = [
  { id: 'env-project', name: 'Lobe Write', visibility: 'private' },
  { id: 'env-project-public', name: 'Lobe Write (public)', visibility: 'public' },
];

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectoryStore: (selector: (s: object) => unknown) =>
    selector({ useFetchEnvironments: state.fetchEnvironments }),
  useProjectEnvironments: (projectId?: string) => (projectId ? PROJECT_ENVIRONMENTS : []),
}));

beforeEach(() => {
  state.listEnvironments.mockReset().mockResolvedValue({
    environments: [{ id: 'env-shared', name: 'lobe-tts', visibility: 'private' }],
  });
  state.fetchEnvironments.mockReset().mockReturnValue({
    error: undefined,
    hasData: true,
    revalidate: vi.fn(),
  });
});

describe('useSandboxEnvironmentList', () => {
  // The workspace's shared list leaves a project's environment out, so a
  // project conversation showed its own environment as unavailable.
  it("offers a project conversation its project's environment, not the shared list", () => {
    const { result } = renderHook(() =>
      useSandboxEnvironmentList({ projectId: 'project-1', sharedAgent: false }),
    );

    expect(result.current.environments.map((e) => e.id)).toEqual([
      'env-project',
      'env-project-public',
    ]);
    expect(result.current.loaded).toBe(true);
    expect(state.fetchEnvironments).toHaveBeenCalledWith('project-1', true);
    expect(state.listEnvironments).not.toHaveBeenCalled();
  });

  it('offers a workspace-public agent the published project environment only', () => {
    const { result } = renderHook(() =>
      useSandboxEnvironmentList({ projectId: 'project-1', sharedAgent: true }),
    );

    expect(result.current.environments.map((e) => e.id)).toEqual(['env-project-public']);
  });

  it("reports the project list's failure rather than an empty list", () => {
    state.fetchEnvironments.mockReturnValue({ error: new Error('offline'), hasData: false });
    const { result } = renderHook(() =>
      useSandboxEnvironmentList({ projectId: 'project-1', sharedAgent: false }),
    );

    expect(result.current.failed).toBe(true);
    expect(result.current.loaded).toBe(false);
  });

  it("offers any other conversation the workspace's shared environments", async () => {
    const { result } = renderHook(() =>
      useSandboxEnvironmentList({ sharedAgent: false, workspaceId: 'workspace-1' }),
    );

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.environments.map((e) => e.id)).toEqual(['env-shared']);
    // No project: its list is not fetched.
    expect(state.fetchEnvironments).toHaveBeenCalledWith(undefined, false);
  });
});

describe('useProjectSandboxEnvironments', () => {
  // The composer section renders for runs that never use the sandbox too.
  it('does not fetch while the run does not use the sandbox', () => {
    renderHook(() => useProjectSandboxEnvironments('project-1', false, false));

    expect(state.fetchEnvironments).toHaveBeenCalledWith('project-1', false);
  });
});

describe('useIsSharedAgent', () => {
  // A split or embedded conversation's agent need not be the active one, and
  // the server checks the topic's own agent.
  it("reads the conversation's own agent, not the active one", () => {
    expect(renderHook(() => useIsSharedAgent('agent-public')).result.current).toBe(true);
    expect(renderHook(() => useIsSharedAgent('agent-private')).result.current).toBe(false);
  });
});
