import { describe, expect, it } from 'vitest';

import { resolveOperationInitSlots } from './operationInitSlots';

const discovery = (overrides: Record<string, unknown>) =>
  ({
    credentialFactsPromise: Promise.resolve(undefined),
    modelMediaCapabilities: {},
    toolsResult: { enabledToolIds: [] },
    ...overrides,
  }) as any;
const prep = { deviceSystemInfo: { workingDirectory: '/srv/project' } } as any;

describe('resolveOperationInitSlots — device binding', () => {
  it('binds a waking managed device to the operation', async () => {
    const slots = await resolveOperationInitSlots({
      discovery: discovery({
        executionPlan: { deviceId: 'managed-a', kind: 'device-wakeable', target: 'device' },
      }),
      initialContext: undefined as any,
      prep,
    });

    expect(slots.activeDeviceId).toBe('managed-a');
    expect(slots.deviceSystemInfo).toEqual({ workingDirectory: '/srv/project' });
  });

  it('keeps the routed device and binds nothing for an unrouted plan', async () => {
    const routed = await resolveOperationInitSlots({
      discovery: discovery({
        activeDeviceId: 'device-a',
        executionPlan: { deviceId: 'device-a', kind: 'device', target: 'device' },
      }),
      initialContext: undefined as any,
      prep,
    });
    const unrouted = await resolveOperationInitSlots({
      discovery: discovery({
        executionPlan: {
          kind: 'device-unrouted',
          reason: 'bound-device-offline',
          target: 'device',
        },
      }),
      initialContext: undefined as any,
      prep,
    });

    expect(routed.activeDeviceId).toBe('device-a');
    expect(unrouted.activeDeviceId).toBeUndefined();
  });
});
