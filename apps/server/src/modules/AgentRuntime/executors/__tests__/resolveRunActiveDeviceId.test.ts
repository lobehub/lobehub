import { describe, expect, it } from 'vitest';

import { resolveRunActiveDeviceId } from '../resolveRunActiveDeviceId';

describe('resolveRunActiveDeviceId', () => {
  it('passes the id through when the plan routed a device', () => {
    expect(
      resolveRunActiveDeviceId({
        binding: { device: { id: 'device-1' } },
        plan: { execution: { deviceId: 'device-1', kind: 'device', target: 'device' } },
      }),
    ).toBe('device-1');
  });

  // Mid-run device activation: the model selects a device via the
  // lobe-remote-device tool while the run-start plan still says unrouted —
  // the folded-back id must survive the gate.
  it('passes a mid-run activated id through under a device-unrouted plan', () => {
    expect(
      resolveRunActiveDeviceId({
        binding: { device: { id: 'device-1' } },
        plan: { execution: { kind: 'device-unrouted', reason: 'no-bound-device', target: 'auto' } },
      }),
    ).toBe('device-1');
  });

  it('swallows a preset/stale id when the plan is not device-capable', () => {
    for (const kind of ['sandbox', 'none'] as const) {
      expect(
        resolveRunActiveDeviceId({
          binding: { device: { id: 'device-1' } },
          plan: { execution: { kind, target: kind } },
        }),
      ).toBeUndefined();
    }
  });

  it('swallows the id when the device access policy denies the sender', () => {
    expect(
      resolveRunActiveDeviceId({
        binding: { device: { id: 'device-1' } },
        principal: {
          policy: {
            deviceAccess: { canUseDevice: false, reason: 'external-bot' },
          },
        },
        plan: {
          execution: { deviceId: 'device-1', kind: 'device', target: 'device' },
        },
      }),
    ).toBeUndefined();
  });

  it('falls back to the policy-only gate when no plan exists (old/resumed operations)', () => {
    expect(resolveRunActiveDeviceId({ binding: { device: { id: 'device-1' } } })).toBe('device-1');
    expect(resolveRunActiveDeviceId({})).toBeUndefined();
  });

  it('ignores a device that only has system info but no id', () => {
    expect(
      resolveRunActiveDeviceId({ binding: { device: { systemInfo: { workingDirectory: '/w' } } } }),
    ).toBeUndefined();
  });
});
