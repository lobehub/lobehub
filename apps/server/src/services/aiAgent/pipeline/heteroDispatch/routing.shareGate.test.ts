import { describe, expect, it, vi } from 'vitest';

import { resolveHeteroRouting } from './routing';

vi.mock('@/server/services/deviceGateway/managedDeviceWake', () => ({
  findWakeableManagedDevices: vi.fn().mockResolvedValue([]),
}));

const deps = { db: {}, resolveDeviceWorkspaceId: vi.fn(), userId: 'creator' } as any;
const input = {
  canManageAgent: false,
  heteroType: 'claude-code',
  isPublicWorkspaceAgent: false,
} as any;
// No device is bound: the only place left for a Claude Code run is the sandbox.
const agentConfig = { agencyConfig: { executionTarget: 'sandbox' }, userId: 'creator' } as any;

describe('resolveHeteroRouting — share visitor', () => {
  it('routes a deviceless Claude Code agent to the cloud sandbox without a share gate', async () => {
    const routing = await resolveHeteroRouting(deps, { agentConfig, canUseDevice: true }, input);

    expect(routing.deviceHeteroPlan?.kind).toBe('sandbox');
  });

  it('never resolves to the cloud sandbox for a share visitor', async () => {
    const routing = await resolveHeteroRouting(
      deps,
      { agentConfig, canUseDevice: true, shareGate: { canUseDevice: true } as any },
      input,
    );

    expect(routing.deviceHeteroPlan?.kind).not.toBe('sandbox');
  });
});
