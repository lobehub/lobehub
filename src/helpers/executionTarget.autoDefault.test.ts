import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveExecutionPlan, resolveExecutionTarget } from './executionTarget';

const cfg = (over: Partial<LobeAgentAgencyConfig> = {}): LobeAgentAgencyConfig => ({ ...over });

describe('unset execution target defaults to auto off the desktop', () => {
  it('resolves to auto on web when a gateway can route to a device', () => {
    const web = { clientExecutionAvailable: false, deviceRoutingAvailable: true };
    expect(resolveExecutionTarget(undefined, web)).toBe('auto');
    expect(resolveExecutionTarget(cfg(), web)).toBe('auto');
    expect(resolveExecutionTarget(cfg(), { ...web, workspaceScoped: true })).toBe('auto');
    // desktop keeps its in-process default
    expect(resolveExecutionTarget(cfg(), { ...web, clientExecutionAvailable: true })).toBe('local');
    // no gateway → nothing to route to
    expect(resolveExecutionTarget(cfg(), { clientExecutionAvailable: false })).toBe('none');
    // an explicit pick always wins
    expect(resolveExecutionTarget(cfg({ executionTarget: 'none' }), web)).toBe('none');
    // a leftover binding is not overridden by the auto default
    expect(resolveExecutionTarget(cfg({ boundDeviceId: 'device-a' }), web)).toBe('none');
    // hetero agents keep their own sandbox fallback
    expect(resolveExecutionTarget(cfg(), { ...web, isHetero: true })).toBe('sandbox');
  });

  it('auto-picks a device in the server plan when no desktop runs it in-process', () => {
    const params = { clientExecutionAvailable: true, onlineDeviceIds: ['device-a'] };
    expect(resolveExecutionPlan({ ...params, agencyConfig: cfg() })).toEqual({
      deviceId: 'device-a',
      kind: 'device',
      target: 'auto',
    });
    expect(
      resolveExecutionPlan({ ...params, agencyConfig: cfg(), onlineDeviceIds: ['a', 'b'] }),
    ).toEqual({ kind: 'device-unrouted', reason: 'ambiguous-online-devices', target: 'auto' });
    expect(resolveExecutionPlan({ ...params, agencyConfig: cfg(), onlineDeviceIds: [] })).toEqual({
      kind: 'device-unrouted',
      reason: 'no-online-device',
      target: 'auto',
    });
    // the desktop that sends its own deviceId keeps the in-process default …
    expect(
      resolveExecutionPlan({ ...params, agencyConfig: cfg(), localDeviceId: 'device-a' }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'local' });
    // … and, while offline, never grabs another online device
    expect(
      resolveExecutionPlan({ ...params, agencyConfig: undefined, localDeviceId: 'this-desktop' }),
    ).toEqual({ kind: 'device-unrouted', reason: 'bound-device-offline', target: 'local' });
    // no gateway → nothing to route to
    expect(
      resolveExecutionPlan({ ...params, agencyConfig: cfg(), clientExecutionAvailable: false }),
    ).toEqual({ kind: 'none', target: 'none' });
    // an explicit `none` stays plain chat
    expect(
      resolveExecutionPlan({ ...params, agencyConfig: cfg({ executionTarget: 'none' }) }),
    ).toEqual({ kind: 'none', target: 'none' });
  });
});
