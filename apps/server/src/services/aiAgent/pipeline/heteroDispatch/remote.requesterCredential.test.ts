// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchToPlatformDevice } from './remote';

const mocks = vi.hoisted(() => ({
  enforced: vi.fn(),
  executeToolCall: vi.fn(),
  fail: vi.fn(),
}));

vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: () => ({ publishAgentRuntimeInit: async () => undefined }),
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { executeToolCall: mocks.executeToolCall },
}));
vi.mock('@/server/services/deviceGateway/dispatchAuthorization', () => ({
  resolveDeviceDispatchAuthorizationFailure: async () => undefined,
}));
vi.mock('@/server/services/scm/requester/enforcement', () => ({
  isRequesterCredentialEnforced: mocks.enforced,
}));
vi.mock('./utils', () => ({ failHeteroDispatch: mocks.fail }));

const dispatch = () =>
  dispatchToPlatformDevice(
    { db: {}, userId: 'user-1', workspaceId: 'ws-1' } as any,
    {
      agentId: 'agent-1',
      assistantMessageId: 'asst-1',
      operationId: 'op-1',
      topicId: 'topic-1',
    } as any,
    {
      agentConfig: { agencyConfig: {} } as any,
      canUseDevice: true,
      deviceAccessReason: 'owner' as any,
      heteroType: 'openclaw' as any,
      persistOperationMetadata: async () => {},
      prompt: 'hi',
      remoteDeviceId: 'device-jp-1',
      remoteDeviceUserId: 'user-1',
      remoteDeviceWorkspaceId: 'ws-1',
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeToolCall.mockResolvedValue({ success: true });
  mocks.fail.mockResolvedValue({ success: false });
});

describe('dispatchToPlatformDevice on a shared device', () => {
  it('refuses while the workspace pushes as the requester, since the platform agent cannot', async () => {
    mocks.enforced.mockResolvedValue(true);

    await expect(dispatch()).resolves.toEqual({ success: false });
    expect(mocks.executeToolCall).not.toHaveBeenCalled();
    expect(mocks.enforced).toHaveBeenCalledWith(
      {},
      { deviceId: 'device-jp-1', ownerUserId: 'user-1', workspaceId: 'ws-1' },
    );
  });

  it('dispatches as before while the policy does not apply', async () => {
    mocks.enforced.mockResolvedValue(false);

    await expect(dispatch()).resolves.toBeUndefined();
    expect(mocks.executeToolCall).toHaveBeenCalled();
  });
});
