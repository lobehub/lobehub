import { MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveExecutionPlan } from '@/helpers/executionTarget';

import { getDeviceOptionState } from '../deviceOptionState';

const sleepingManaged = {
  identitySource: MANAGED_CLOUD_DEVICE_IDENTITY_SOURCE,
  managedPhase: 'suspended' as const,
  online: false,
};
const known = { presenceUnknown: false };

describe('getDeviceOptionState', () => {
  // Regression: a sleeping managed device was disabled like an offline
  // machine, so the run fell back to the cloud sandbox and never woke it.
  it('lets the user pick a sleeping managed device, and the bound run wakes it', () => {
    expect(getDeviceOptionState(sleepingManaged, known)).toEqual({
      offlineLabelKey: 'heteroAgent.executionTarget.wakesWhenUsed',
      reconnectLabelKey: 'heteroAgent.executionTarget.wake',
      selectable: true,
      showReconnect: true,
    });

    // Picking the row binds the device. The server lists the bound device as
    // wakeable, so the plan wakes it instead of falling back to the sandbox.
    expect(
      resolveExecutionPlan({
        agencyConfig: { boundDeviceId: 'managed-a', executionTarget: 'device' },
        clientExecutionAvailable: true,
        onlineDeviceIds: [],
        wakeableDeviceIds: ['managed-a'],
      }),
    ).toEqual({ deviceId: 'managed-a', kind: 'device-wakeable', target: 'device' });
  });

  it('keeps a managed device that cannot be woken unselectable and without a control', () => {
    expect(getDeviceOptionState({ ...sleepingManaged, managedPhase: 'failed' }, known)).toEqual({
      offlineLabelKey: 'heteroAgent.executionTarget.offline',
      reconnectLabelKey: 'heteroAgent.executionTarget.reconnect',
      selectable: false,
      showReconnect: false,
    });
  });

  it('keeps an offline connected device unselectable with its desktop reconnect', () => {
    expect(getDeviceOptionState({ identitySource: 'machine-id', online: false }, known)).toEqual({
      offlineLabelKey: 'heteroAgent.executionTarget.offline',
      reconnectLabelKey: 'heteroAgent.executionTarget.reconnect',
      selectable: false,
      showReconnect: true,
    });
  });

  it('shows no control on an online device or a row whose presence is unknown', () => {
    expect(
      getDeviceOptionState({ identitySource: 'machine-id', online: true }, known),
    ).toMatchObject({ selectable: true, showReconnect: false });
    expect(getDeviceOptionState(sleepingManaged, { presenceUnknown: true }).showReconnect).toBe(
      false,
    );
  });
});
