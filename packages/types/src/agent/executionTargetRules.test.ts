import type * as BusinessConst from '@lobechat/business-const';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExecutionPlan } from './agencyConfig';

const offlineBoundDevice = {
  kind: 'device-unrouted',
  reason: 'bound-device-offline',
  target: 'device',
} as unknown as ExecutionPlan;

const loadDescribe = async (branding?: Partial<typeof BusinessConst>) => {
  vi.resetModules();
  if (branding) {
    vi.doMock('@lobechat/business-const', async (importOriginal) => ({
      ...(await importOriginal<typeof BusinessConst>()),
      ...branding,
    }));
    // Under vitest 5 a `doMock` only lands once the test file itself imports
    // something, so pull the mocked module in before the one under test.
    await import('@lobechat/business-const');
  }
  return (await import('./executionTargetRules')).describeLockedDevicePicker;
};

afterEach(() => {
  vi.doUnmock('@lobechat/business-const');
  vi.resetModules();
});

describe('describeLockedDevicePicker', () => {
  it('points at the upstream desktop app under default branding', async () => {
    const describeLockedDevicePicker = await loadDescribe();

    expect(describeLockedDevicePicker(offlineBoundDevice)).toContain(
      'Tell the user to reconnect it (LobeHub desktop app or `lh connect`).',
    );
  });

  it("points at the deployment's own desktop app under custom branding", async () => {
    const describeLockedDevicePicker = await loadDescribe({ BRANDING_NAME: 'Acme' });
    const hint = describeLockedDevicePicker(offlineBoundDevice);

    expect(hint).toContain('Tell the user to reconnect it (Acme desktop app or `lh connect`).');
    expect(hint).not.toContain('LobeHub');
  });

  it('tells the model to retry while a managed device starts', async () => {
    const describeLockedDevicePicker = await loadDescribe();
    const hint = describeLockedDevicePicker({
      deviceId: 'managed-a',
      kind: 'device-wakeable',
      target: 'device',
    });

    expect(hint).toContain('managed cloud device "managed-a", which is starting');
    expect(hint).toContain('DEVICE_WAKING');
  });
});

describe('describeWithheldDevicePicker', () => {
  const load = async () => {
    vi.resetModules();
    return (await import('./executionTargetRules')).describeWithheldDevicePicker;
  };

  it.each([
    [{ kind: 'none', target: 'none' }, 'has no execution environment'],
    [{ kind: 'sandbox', target: 'sandbox' }, 'runs in the cloud sandbox'],
  ] as const)('explains a run without a device (%o)', async (plan, expected) => {
    const describeWithheldDevicePicker = await load();
    const hint = describeWithheldDevicePicker(plan as unknown as ExecutionPlan);

    expect(hint).toContain(expected);
    expect(hint).toContain('device selector');
  });

  it('keeps the locked-run wording for a locked plan', async () => {
    const describeWithheldDevicePicker = await load();

    expect(describeWithheldDevicePicker(offlineBoundDevice)).toContain(
      "locked to the user's bound device",
    );
  });

  it('returns nothing while the picker is offered', async () => {
    const describeWithheldDevicePicker = await load();

    expect(
      describeWithheldDevicePicker({
        kind: 'device-unrouted',
        reason: 'ambiguous-online-devices',
        target: 'auto',
      } as unknown as ExecutionPlan),
    ).toBeUndefined();
  });
});
