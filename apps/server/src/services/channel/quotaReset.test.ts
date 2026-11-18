// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { knownQuotaReset } from './quotaReset';

const { model } = vi.hoisted(() => ({
  model: { construct: vi.fn(), findLatestSettledByAgent: vi.fn() },
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    constructor(...args: unknown[]) {
      model.construct(...args);
      return model;
    }
  },
}));

const now = Date.parse('2026-11-18T04:41:00Z');
const resetsAt = Date.parse('2026-11-18T07:00:00Z');
const candidate = {
  agent: { id: 'agt-cook', name: 'Cook', title: null },
  requesterUserId: 'user-lijian',
  workspaceId: 'ws-1',
};

/** What a Claude Code run refused by its 5-hour window stores on its operation. */
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
  status: 'error',
});

describe('knownQuotaReset', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the reset of a window that refused the requester’s last run and is still closed', async () => {
    model.findLatestSettledByAgent.mockResolvedValue(refusal());

    await expect(knownQuotaReset({} as never, candidate, now)).resolves.toBe(resetsAt);
    // The run happens as the requester, in the Channel's workspace.
    expect(model.construct).toHaveBeenCalledWith({}, 'user-lijian', 'ws-1');
    expect(model.findLatestSettledByAgent).toHaveBeenCalledWith(
      'agt-cook',
      new Date(now - 8 * 24 * 60 * 60 * 1000),
    );
  });

  it('says nothing once the window has reopened', async () => {
    model.findLatestSettledByAgent.mockResolvedValue(refusal({ resetsAt: now - 60_000 }));

    await expect(knownQuotaReset({} as never, candidate, now)).resolves.toBeUndefined();
  });

  it('says nothing after a run that finished, or one that failed for another reason', async () => {
    model.findLatestSettledByAgent.mockResolvedValueOnce({ error: null, status: 'done' });
    await expect(knownQuotaReset({} as never, candidate, now)).resolves.toBeUndefined();

    model.findLatestSettledByAgent.mockResolvedValueOnce({
      error: { message: 'Device is offline', type: 'DeviceUnreachable' },
      status: 'error',
    });
    await expect(knownQuotaReset({} as never, candidate, now)).resolves.toBeUndefined();

    model.findLatestSettledByAgent.mockResolvedValueOnce(null);
    await expect(knownQuotaReset({} as never, candidate, now)).resolves.toBeUndefined();
  });

  it('ignores window details stamped on a run the window allowed', async () => {
    model.findLatestSettledByAgent.mockResolvedValue(refusal({ status: 'allowed' }));

    await expect(knownQuotaReset({} as never, candidate, now)).resolves.toBeUndefined();
  });
});
