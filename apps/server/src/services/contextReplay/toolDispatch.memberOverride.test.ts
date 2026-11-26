// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { assertCurrentToolDispatch } from './toolDispatch';

const { agentPolicy, findMessage, preference } = vi.hoisted(() => ({
  agentPolicy: vi.fn(),
  findMessage: vi.fn(),
  preference: vi.fn(),
}));

vi.mock('@/server/routers/lambda/_helpers/conversationResourceGuard', () => ({
  assertCanUseConversationTargets: vi.fn(),
}));
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentToolPolicy = agentPolicy;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = async () => ({ metadata: { conversationMode: 'agent' } });
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    getContextReplays = async (ids: string[]) =>
      ids[0] !== 'assistant-1'
        ? {}
        : {
            'assistant-1': {
              changes: [],
              executionBinding: { agentDeviceId: 'member-device', topicDeviceId: null },
              invocationId: 'assistant-1',
              sessionKey: 'device',
              sourceIds: [],
              version: 1,
            },
          };
    findById = findMessage;
  },
}));
vi.mock('@/database/models/workspaceUserSettings', () => ({
  WorkspaceUserSettingsModel: class {
    getPreference = preference;
  },
}));
vi.mock('@/server/services/resourcePermission', () => ({
  isResourceAuthorOrAdmin: async () => false,
}));

const call = {
  agentId: 'agent-1',
  apiName: 'runCommand',
  assistantMessageId: 'assistant-1',
  db: {} as never,
  expectedDeviceId: 'member-device',
  identifier: 'lobe-local-system',
  topicId: 'topic-1',
  userId: 'member',
  workspaceId: 'workspace-1',
};

beforeEach(() => {
  findMessage.mockImplementation(async (id: string) =>
    id === 'tool-1'
      ? { id, parentId: 'assistant-1', role: 'tool', topicId: 'topic-1' }
      : { agentId: 'agent-1', id, role: 'assistant', topicId: 'topic-1' },
  );
  agentPolicy.mockResolvedValue({
    agencyConfig: { boundDeviceId: 'shared-device', executionTarget: 'none' },
    chatConfig: {},
    plugins: [],
    userId: 'owner',
    visibility: 'public',
    workspaceId: 'workspace-1',
  });
  preference.mockResolvedValue({
    agentDeviceOverrides: {
      'agent-1': { boundDeviceId: 'member-device', executionTarget: 'device' },
    },
  });
});

it("dispatches a device tool on the member's own device override", async () => {
  await expect(assertCurrentToolDispatch(call)).resolves.toBeUndefined();
});

it('still rejects a device tool after the member switches to another device', async () => {
  preference.mockResolvedValue({
    agentDeviceOverrides: {
      'agent-1': { boundDeviceId: 'other-device', executionTarget: 'device' },
    },
  });
  await expect(assertCurrentToolDispatch(call)).rejects.toThrow(/device/i);
});

it('checks a resumed tool call against the snapshot of its assistant', async () => {
  await expect(
    assertCurrentToolDispatch({ ...call, assistantMessageId: 'tool-1' }),
  ).resolves.toBeUndefined();
});
