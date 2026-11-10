/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentTopicGroupMode } from './useAgentTopicGroupMode';

const scopeMock = vi.hoisted(() => ({ scope: null as null | { projectId: string } }));
const preferenceMock = vi.hoisted(() => ({
  globalMode: 'byTime' as string,
  projectMode: 'byAgent' as string,
  updatePreference: vi.fn(),
}));
const agentMock = vi.hoisted(() => ({ agentMode: undefined as string | undefined }));

vi.mock('../TopicListScope', () => ({
  useTopicListScope: () => scopeMock.scope,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({ updatePreference: preferenceMock.updatePreference }),
}));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: {
    projectTopicGroupMode: () => preferenceMock.projectMode,
    topicGroupMode: () => preferenceMock.globalMode,
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ updateAgentChatConfig: vi.fn() }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentConfig: () => ({ chatConfig: { topicGroupMode: agentMock.agentMode } }),
    currentAgentHeterogeneousProviderType: () => undefined,
  },
}));

describe('useAgentTopicGroupMode', () => {
  beforeEach(() => {
    scopeMock.scope = null;
    preferenceMock.globalMode = 'byTime';
    preferenceMock.projectMode = 'byAgent';
    preferenceMock.updatePreference.mockClear();
    agentMock.agentMode = undefined;
  });

  it('groups a project-scoped list by agent unless the project preference says otherwise', () => {
    scopeMock.scope = { projectId: 'prj-1' };
    // The single-agent preference no longer leaks into a project.
    preferenceMock.globalMode = 'byStatus';

    const { result, rerender } = renderHook(() => useAgentTopicGroupMode());
    expect(result.current.topicGroupMode).toBe('byAgent');

    preferenceMock.projectMode = 'byDevice';
    rerender();
    expect(result.current.topicGroupMode).toBe('byDevice');
  });

  it('saves a project-scoped pick to the project preference only', async () => {
    scopeMock.scope = { projectId: 'prj-1' };

    const { result } = renderHook(() => useAgentTopicGroupMode());
    await result.current.updateTopicGroupMode('byStatus');

    expect(preferenceMock.updatePreference).toHaveBeenCalledWith({
      projectTopicGroupMode: 'byStatus',
    });
  });

  /** @example a stale byProject must not reach a project's own topic list. */
  it('resolves a stored byProject to byAgent inside a project-scoped list', () => {
    scopeMock.scope = { projectId: 'prj-1' };
    preferenceMock.projectMode = 'byProject';

    const { result } = renderHook(() => useAgentTopicGroupMode());

    expect(result.current.topicGroupMode).toBe('byAgent');
  });

  it("keeps byProject in an agent's own sidebar", () => {
    agentMock.agentMode = 'byProject';

    const { result } = renderHook(() => useAgentTopicGroupMode());

    expect(result.current.topicGroupMode).toBe('byProject');
  });
});
