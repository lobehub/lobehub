// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { knownQuotaReset } from './quotaReset';

const { executions, quota } = vi.hoisted(() => ({
  executions: { lastSettledReplyOnDevice: vi.fn() },
  quota: { construct: vi.fn(), planDeviceRouting: vi.fn(), resolveDeviceRowId: vi.fn() },
}));
vi.mock('@/database/repositories/channel', () => ({
  ChannelExecutionRepository: class {
    constructor() {
      return executions;
    }
  },
}));
vi.mock('@/server/services/agentQuota', () => ({
  AgentQuotaService: class {
    constructor(...args: unknown[]) {
      quota.construct(...args);
      return quota;
    }
  },
}));

const now = Date.parse('2026-11-18T04:41:00Z');
const resetsAt = Date.parse('2026-11-18T07:00:00Z');
const candidate = {
  agent: { id: 'agt-cook', name: 'Cook', title: null },
  deviceId: 'device-cloud-1',
  memberId: 'member-cook',
  requesterUserId: 'user-lijian',
  workspaceId: 'ws-1',
};

/** A reply whose Claude Code run its 5-hour window refused, as the job and operation store it. */
const refusal = (patch: { resetsAt?: number; status?: string } = {}) => ({
  error: {
    body: {
      agentType: 'claude-code',
      code: 'rate_limit',
      rateLimitInfo: {
        rateLimitType: 'five_hour',
        resetsAt: (patch.resetsAt ?? resetsAt) / 1000,
        status: patch.status ?? 'rejected',
      },
    },
    category: 'quota',
    message: "You've hit your 5-hour limit · resets 3pm (Asia/Shanghai)",
    type: 'AgentRuntimeError',
  },
  status: 'failed',
});

describe('knownQuotaReset', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    quota.resolveDeviceRowId.mockResolvedValue('device-row-1');
    quota.planDeviceRouting.mockResolvedValue(null);
  });

  it('returns the reset of a window that refused the last reply on the picked device', async () => {
    executions.lastSettledReplyOnDevice.mockResolvedValue(refusal());

    await expect(knownQuotaReset({} as never, 'channel', candidate, now)).resolves.toBe(resetsAt);
    expect(executions.lastSettledReplyOnDevice).toHaveBeenCalledWith('channel', {
      deviceId: 'device-cloud-1',
      memberId: 'member-cook',
      since: new Date(now - 8 * 24 * 60 * 60 * 1000),
    });
    // The login is resolved the way the device dispatch resolves it, as the requester.
    expect(quota.construct).toHaveBeenCalledWith({}, 'user-lijian', 'ws-1');
    expect(quota.planDeviceRouting).toHaveBeenCalledWith('agt-cook', {
      deviceId: 'device-row-1',
      provider: 'claude-code',
    });
  });

  it('assumes nothing when no device is picked in the Channel, since only the claim resolves it', async () => {
    await expect(
      knownQuotaReset({} as never, 'channel', { ...candidate, deviceId: undefined }, now),
    ).resolves.toBeUndefined();
    expect(executions.lastSettledReplyOnDevice).not.toHaveBeenCalled();
  });

  it('says nothing when the Agent balances several logins on the device', async () => {
    executions.lastSettledReplyOnDevice.mockResolvedValue(refusal());
    quota.planDeviceRouting.mockResolvedValue({
      candidates: [{ externalAccountId: 'a' }, { externalAccountId: 'b' }],
      mode: 'balanced',
    });

    await expect(knownQuotaReset({} as never, 'channel', candidate, now)).resolves.toBeUndefined();
  });

  it('keeps the refusal when the device runs one login, pinned or default', async () => {
    executions.lastSettledReplyOnDevice.mockResolvedValue(refusal());
    quota.planDeviceRouting.mockResolvedValue({
      candidates: [{ externalAccountId: 'a' }],
      mode: 'pinned',
    });

    await expect(knownQuotaReset({} as never, 'channel', candidate, now)).resolves.toBe(resetsAt);
  });

  it('says nothing once the window has reopened', async () => {
    executions.lastSettledReplyOnDevice.mockResolvedValue(refusal({ resetsAt: now - 60_000 }));

    await expect(knownQuotaReset({} as never, 'channel', candidate, now)).resolves.toBeUndefined();
  });

  it('says nothing after a reply that finished, or one that failed for another reason', async () => {
    executions.lastSettledReplyOnDevice.mockResolvedValueOnce({ error: null, status: 'completed' });
    await expect(knownQuotaReset({} as never, 'channel', candidate, now)).resolves.toBeUndefined();

    executions.lastSettledReplyOnDevice.mockResolvedValueOnce({
      error: { message: 'Device is offline', type: 'DeviceUnreachable' },
      status: 'failed',
    });
    await expect(knownQuotaReset({} as never, 'channel', candidate, now)).resolves.toBeUndefined();

    executions.lastSettledReplyOnDevice.mockResolvedValueOnce(undefined);
    await expect(knownQuotaReset({} as never, 'channel', candidate, now)).resolves.toBeUndefined();
    expect(quota.planDeviceRouting).not.toHaveBeenCalled();
  });

  it('ignores window details stamped on a run the window allowed', async () => {
    executions.lastSettledReplyOnDevice.mockResolvedValue(refusal({ status: 'allowed' }));

    await expect(knownQuotaReset({} as never, 'channel', candidate, now)).resolves.toBeUndefined();
  });
});
