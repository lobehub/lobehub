import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  type ExecutionPlan,
  executionPlanToManifestExecutionEnv,
  isDeviceCapablePlan,
  isDeviceLockedPlan,
  resolveExecutionPlan,
} from './executionTarget';

const cfg = (over: Partial<LobeAgentAgencyConfig> = {}): LobeAgentAgencyConfig => ({ ...over });
const ONLINE_AB = ['device-a', 'device-b'];

describe('resolveExecutionPlan — wakeableDeviceIds (managed cloud devices)', () => {
  it('wakes an offline bound managed device instead of leaving the run unrouted', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'managed-a', executionTarget: 'device' }),
        clientExecutionAvailable: true,
        onlineDeviceIds: ONLINE_AB,
        wakeableDeviceIds: ['managed-a'],
      }),
    ).toEqual({ deviceId: 'managed-a', kind: 'device-wakeable', target: 'device' });
  });

  it('wakes a requested managed device and keeps the local target', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ executionTarget: 'local' }),
        clientExecutionAvailable: true,
        onlineDeviceIds: [],
        requestedDeviceId: 'managed-a',
        wakeableDeviceIds: ['managed-a'],
      }),
    ).toEqual({ deviceId: 'managed-a', kind: 'device-wakeable', target: 'local' });
  });

  it('wakes the bound managed device for hetero dispatch without online info', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'managed-a', executionTarget: 'device' }),
        clientExecutionAvailable: false,
        isHetero: true,
        wakeableDeviceIds: ['managed-a'],
      }),
    ).toEqual({ deviceId: 'managed-a', kind: 'device-wakeable', target: 'device' });
  });

  it('routes to the device when it is already online', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'device' }),
        clientExecutionAvailable: true,
        onlineDeviceIds: ONLINE_AB,
        wakeableDeviceIds: ['device-a'],
      }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
  });

  it('keeps an offline ordinary device unrouted', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-x', executionTarget: 'device' }),
        clientExecutionAvailable: true,
        onlineDeviceIds: ONLINE_AB,
        wakeableDeviceIds: ['managed-a'],
      }),
    ).toEqual({ kind: 'device-unrouted', reason: 'bound-device-offline', target: 'device' });
  });

  it('never wakes a device for a run that may not use one', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'managed-a', executionTarget: 'device' }),
        canUseDevice: false,
        clientExecutionAvailable: true,
        onlineDeviceIds: [],
        wakeableDeviceIds: ['managed-a'],
      }),
    ).toEqual({ kind: 'none', target: 'none' });
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'managed-a', executionTarget: 'sandbox' }),
        clientExecutionAvailable: true,
        onlineDeviceIds: [],
        wakeableDeviceIds: ['managed-a'],
      }),
    ).toEqual({ kind: 'sandbox', target: 'sandbox' });
  });

  it('ignores a stale binding in auto mode', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'managed-a', executionTarget: 'auto' }),
        clientExecutionAvailable: true,
        onlineDeviceIds: [],
        wakeableDeviceIds: ['managed-a'],
      }),
    ).toEqual({ kind: 'device-unrouted', reason: 'no-online-device', target: 'auto' });
  });
});

describe('device-wakeable plan consumers', () => {
  const plan: ExecutionPlan = {
    deviceId: 'managed-a',
    kind: 'device-wakeable',
    target: 'device',
  };

  it('locks the run to the waking device and keeps it device-capable', () => {
    expect(isDeviceLockedPlan(plan)).toBe(true);
    expect(isDeviceCapablePlan(plan)).toBe(true);
  });

  it('describes the waking device as the device it runs on, not as unrouted', () => {
    expect(executionPlanToManifestExecutionEnv(plan)).toBe('device');
  });
});
