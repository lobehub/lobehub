import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStartDirectoryConversation } from './useStartProjectTopic';

const { navigate, startProjectTopicDraft } = vi.hoisted(() => ({
  navigate: vi.fn(),
  startProjectTopicDraft: vi.fn(),
}));

let fixedDeviceId: string | null | undefined;

vi.mock('./startProjectTopicDraft', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startProjectTopicDraft,
}));
vi.mock('./useAgentFixedDeviceId', () => ({ useAgentFixedDeviceId: () => fixedDeviceId }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

const directory = {
  deviceId: 'device-1',
  environmentId: 'env-1',
  id: 'pwd_1',
  instanceId: 'ins-1',
  permission: 'readWrite',
};

const start = (dir: typeof directory) =>
  renderHook(() => useStartDirectoryConversation('prj_1', 'agt_lead')).result.current(dir);

describe('useStartDirectoryConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixedDeviceId = undefined;
  });

  it('opens a blank draft on a directory the agent can run in', () => {
    start(directory);

    expect(startProjectTopicDraft).toHaveBeenCalledWith({
      agentId: 'agt_lead',
      directoryId: 'pwd_1',
      navigate,
      projectId: 'prj_1',
    });
  });

  /** @example User report: the settings "start conversation" left an empty untitled topic behind. */
  it('opens a conversation-only draft instead of creating a topic on a directory the agent cannot use', () => {
    // ROOT CAUSE: a directory a draft can't stage on (read-only, or on another
    // device than the agent is fixed to) fell back to creating a bound topic
    // up front.
    fixedDeviceId = 'device-2';
    start(directory);
    start({ ...directory, permission: 'read' });

    expect(startProjectTopicDraft).toHaveBeenCalledTimes(2);
    for (const [params] of startProjectTopicDraft.mock.calls)
      expect(params).toEqual({
        agentId: 'agt_lead',
        directoryId: undefined,
        navigate,
        projectId: 'prj_1',
      });
  });
});
