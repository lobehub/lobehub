// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { assertCurrentToolDispatch } from './toolDispatch';

const { agentPolicy, preference } = vi.hoisted(() => ({
  agentPolicy: vi.fn(),
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
  db: {} as never,
  expectedBinding: { agentDeviceId: 'member-device', topicDeviceId: null },
  expectedDeviceId: 'member-device',
  identifier: 'lobe-local-system',
  topicId: 'topic-1',
  userId: 'member',
  workspaceId: 'workspace-1',
};

beforeEach(() => {
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

it('checks a device tool against current policy when the run carries no binding', async () => {
  const { expectedBinding: _binding, ...unbound } = call;
  await expect(assertCurrentToolDispatch(unbound)).resolves.toBeUndefined();
  preference.mockResolvedValue({
    agentDeviceOverrides: {
      'agent-1': { boundDeviceId: 'other-device', executionTarget: 'device' },
    },
  });
  await expect(assertCurrentToolDispatch(unbound)).rejects.toThrow(/device/i);
});
