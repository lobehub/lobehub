import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canStageDraftOn,
  isRunnableProjectDirectory,
  startProjectTopicDraft,
} from './startProjectTopicDraft';

const { chat } = vi.hoisted(() => ({
  chat: { setPendingNewTopicDirectory: vi.fn(), switchTopic: vi.fn() },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => chat },
}));

describe('isRunnableProjectDirectory', () => {
  it('requires a linked environment instance and write access', () => {
    const runnable = { environmentId: 'env', instanceId: 'ins', permission: 'readWrite' };

    expect(isRunnableProjectDirectory(runnable)).toBe(true);
    expect(isRunnableProjectDirectory({ ...runnable, permission: 'read' })).toBe(false);
    expect(isRunnableProjectDirectory({ ...runnable, environmentId: null })).toBe(false);
    expect(isRunnableProjectDirectory({ ...runnable, instanceId: undefined })).toBe(false);
  });
});

describe('canStageDraftOn', () => {
  it('keeps a fixed agent on its device', () => {
    const directory = {
      deviceId: 'dev-a',
      environmentId: 'env',
      instanceId: 'ins',
      permission: 'readWrite',
    };

    expect(canStageDraftOn(directory)).toBe(true);
    expect(canStageDraftOn(directory, 'dev-a')).toBe(true);
    expect(canStageDraftOn(directory, 'dev-b')).toBe(false);
    expect(canStageDraftOn({ ...directory, permission: 'read' }, 'dev-a')).toBe(false);
  });

  /** @example Review: an agent fixed to a sandbox was treated as unrestricted, so its draft's first send was refused. */
  it('stages nothing for an agent fixed to a target that is not a device', () => {
    const directory = {
      deviceId: 'dev-a',
      environmentId: 'env',
      instanceId: 'ins',
      permission: 'readWrite',
    };

    expect(canStageDraftOn(directory, null)).toBe(false);
    expect(canStageDraftOn({ ...directory, deviceId: null }, null)).toBe(false);
  });
});

describe('startProjectTopicDraft', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stages the directory on a blank conversation and opens the project composer', () => {
    const navigate = vi.fn();

    startProjectTopicDraft({
      agentId: 'agt_1',
      directoryId: 'pwd_1',
      navigate,
      projectId: 'prj_1',
    });

    // The draft belongs to the target agent, so its blank bucket is the one
    // cleaned — not whichever conversation the "+" was clicked from.
    expect(chat.switchTopic).toHaveBeenCalledWith(null, {
      clearNewKeyContext: { agentId: 'agt_1', groupId: null },
      skipRefreshMessage: true,
    });
    expect(chat.setPendingNewTopicDirectory).toHaveBeenCalledWith({
      agentId: 'agt_1',
      projectWorkingDirectoryId: 'pwd_1',
    });
    // The draft rides in the route so it stays with the pane that opened it.
    expect(navigate).toHaveBeenCalledWith('/project/prj_1/topic?agent=agt_1&dir=pwd_1');
  });
});
