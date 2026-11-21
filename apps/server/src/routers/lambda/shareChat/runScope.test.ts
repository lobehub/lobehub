// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createShareRunScope } from './runScope';

const { resolveDeviceAccess } = vi.hoisted(() => ({ resolveDeviceAccess: vi.fn() }));

vi.mock('@/database/models/message', () => ({ MessageModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserSettings: vi.fn().mockResolvedValue({}) };
  }),
}));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('@/server/services/aiAgent/shareGate/deviceAccess', () => ({
  resolveShareVisitorDeviceAccess: resolveDeviceAccess,
}));

const db = {} as any;
const share = {
  agentId: 'agt_shared',
  ownerId: 'owner',
  shareConfig: { deviceAccess: 'allowlist', deviceAllowUserIds: ['visitor'], toolGrants: [] },
  shareId: 'share-1',
  workspaceId: null,
} as any;

describe('createShareRunScope', () => {
  beforeEach(() => resolveDeviceAccess.mockReset());

  it.each([true, false])(
    "carries the share's device decision for this visitor (%s) on the gate",
    async (granted) => {
      resolveDeviceAccess.mockResolvedValue(granted);

      const { dispatchContext, shareGate } = await createShareRunScope(db, share, 'visitor');

      expect(resolveDeviceAccess).toHaveBeenCalledWith(db, share, 'visitor');
      expect(shareGate).toEqual({
        agentId: 'agt_shared',
        canUseDevice: granted,
        shareConfig: share.shareConfig,
        shareId: 'share-1',
        visitorUserId: 'visitor',
      });
      // An intervention continuation is gated by the same decision.
      expect(dispatchContext.shareGate).toBe(shareGate);
    },
  );
});
