import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  applyTopicDeviceBinding,
  resolveExecutionPlan,
  resolveExecutionTarget,
} from './executionTarget';

const cfg = (over: Partial<LobeAgentAgencyConfig> = {}): LobeAgentAgencyConfig => ({ ...over });

describe('unset execution target defaults to auto', () => {
  it('resolves to auto on web when a gateway can route to a device', () => {
    const web = { clientExecutionAvailable: false, deviceRoutingAvailable: true };
    expect(resolveExecutionTarget(undefined, web)).toBe('auto');
    expect(resolveExecutionTarget(cfg(), web)).toBe('auto');
    expect(resolveExecutionTarget(cfg(), { ...web, workspaceScoped: true })).toBe('auto');
    // desktop takes the same default when the gateway routes …
    expect(resolveExecutionTarget(cfg(), { ...web, clientExecutionAvailable: true })).toBe('auto');
    // … and keeps its in-process default when it does not
    expect(resolveExecutionTarget(cfg(), { clientExecutionAvailable: true })).toBe('local');
    // no gateway → nothing to route to
    expect(resolveExecutionTarget(cfg(), { clientExecutionAvailable: false })).toBe('none');
    // an explicit pick always wins
    expect(resolveExecutionTarget(cfg({ executionTarget: 'none' }), web)).toBe('none');
    // a leftover binding is not overridden by the auto default
    expect(resolveExecutionTarget(cfg({ boundDeviceId: 'device-a' }), web)).toBe('none');
    // hetero agents keep their own sandbox fallback
    expect(resolveExecutionTarget(cfg(), { ...web, isHetero: true })).toBe('sandbox');
  });

  it('auto-picks a device in the server plan', () => {
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
    // a desktop request takes the same default
    expect(
      resolveExecutionPlan({ ...params, agencyConfig: cfg(), localDeviceId: 'device-a' }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'auto' });
    // an explicit `local` still pins the sending desktop and never grabs another device
    expect(
      resolveExecutionPlan({
        ...params,
        agencyConfig: cfg({ executionTarget: 'local' }),
        localDeviceId: 'this-desktop',
      }),
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

  describe('applyTopicDeviceBinding', () => {
    it('leaves an agent with no stored target to the auto default', () => {
      // An unset target already resolves to `auto`, so converting the topic's
      // machine into a concrete pin here would make the default stricter than an
      // explicit `auto` (which re-picks a device every run).
      const unset = cfg();

      expect(
        applyTopicDeviceBinding({ agencyConfig: unset, workspaceScoped: false }, 'dev-a', undefined)
          .agencyConfig,
      ).toBe(unset);
    });

    it('keeps the topic machine for a model-only heterogeneous agent', () => {
      // Legacy `model: 'claude-code'` agents carry no provider yet; they never
      // take the auto default, so the topic must stay on its machine.
      expect(
        applyTopicDeviceBinding({ agencyConfig: cfg(), workspaceScoped: false }, 'dev-a', 'dev-b', {
          isHetero: true,
        }).agencyConfig,
      ).toMatchObject({ boundDeviceId: 'dev-a', executionTarget: 'device' });
    });

    it('still honours a leftover binding on a config without a stored target', () => {
      // A bound device is not an auto default — `defaultsToAuto` skips it, so the
      // topic keeps routing to its own machine.
      expect(
        applyTopicDeviceBinding(
          { agencyConfig: cfg({ boundDeviceId: 'dev-b' }), workspaceScoped: false },
          'dev-a',
          undefined,
        ).agencyConfig,
      ).toMatchObject({ boundDeviceId: 'dev-a', executionTarget: 'device' });
    });
  });
});
