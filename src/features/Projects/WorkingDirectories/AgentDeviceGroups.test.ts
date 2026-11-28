import { describe, expect, it } from 'vitest';

import { resolveMemberOwnDevice } from './AgentDeviceGroups';

const agent = {
  agencyConfig: {
    boundDeviceId: 'shared-device',
    executionTarget: 'device',
    executionTargetSelectionPolicy: 'fixed',
    heterogeneousProvider: { type: 'claude-code' },
  },
  visibility: 'public',
  workspaceId: 'ws-1',
} as Parameters<typeof resolveMemberOwnDevice>[0];
const override = { boundDeviceId: 'my-device', executionTarget: 'device' as const };

describe('resolveMemberOwnDevice', () => {
  // Review: the page resolved every caller as a member, so an author's own
  // device pick on a fixed agent showed (and preselected) the shared device.
  it("names a manager's own device pick, as the run resolves it", () => {
    expect(resolveMemberOwnDevice(agent, override, true)?.deviceId).toBe('my-device');
  });

  it('keeps a member on the fixed shared device', () => {
    expect(resolveMemberOwnDevice(agent, override, false)?.deviceId).toBe('shared-device');
  });
});
