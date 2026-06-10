import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  type ExecutionPlan,
  executionTargetToRuntimeMode,
  resolveExecutionPlan,
  resolveExecutionTarget,
  resolveRuntimeMode,
} from './executionTarget';

const cfg = (over: Partial<LobeAgentAgencyConfig> = {}): LobeAgentAgencyConfig => ({ ...over });

describe('resolveExecutionTarget', () => {
  it('returns the stored target verbatim when set', () => {
    expect(resolveExecutionTarget(cfg({ executionTarget: 'device' }), { isDesktop: true })).toBe(
      'device',
    );
    expect(resolveExecutionTarget(cfg({ executionTarget: 'sandbox' }), { isDesktop: true })).toBe(
      'sandbox',
    );
  });

  it('defaults to local on desktop, none on web when unset', () => {
    expect(resolveExecutionTarget(undefined, { isDesktop: true })).toBe('local');
    expect(resolveExecutionTarget(undefined, { isDesktop: false })).toBe('none');
    expect(resolveExecutionTarget(cfg(), { isDesktop: true })).toBe('local');
    expect(resolveExecutionTarget(cfg(), { isDesktop: false })).toBe('none');
  });

  it('coerces a stored `local` to `sandbox` on web (no local filesystem)', () => {
    expect(resolveExecutionTarget(cfg({ executionTarget: 'local' }), { isDesktop: false })).toBe(
      'sandbox',
    );
    // …but keeps it on desktop
    expect(resolveExecutionTarget(cfg({ executionTarget: 'local' }), { isDesktop: true })).toBe(
      'local',
    );
  });

  it('keeps `device` on web (a bound device is reachable from anywhere)', () => {
    expect(resolveExecutionTarget(cfg({ executionTarget: 'device' }), { isDesktop: false })).toBe(
      'device',
    );
  });

  it('keeps an explicit `none` on both platforms', () => {
    expect(resolveExecutionTarget(cfg({ executionTarget: 'none' }), { isDesktop: true })).toBe(
      'none',
    );
    expect(resolveExecutionTarget(cfg({ executionTarget: 'none' }), { isDesktop: false })).toBe(
      'none',
    );
  });

  it('coerces `none` for hetero agents — they must execute somewhere', () => {
    // stored none → desktop local, web sandbox
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'none' }), { isDesktop: true, isHetero: true }),
    ).toBe('local');
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'none' }), {
        isDesktop: false,
        isHetero: true,
      }),
    ).toBe('sandbox');
    // unset → platform default, then the same coercion on web
    expect(resolveExecutionTarget(undefined, { isDesktop: true, isHetero: true })).toBe('local');
    expect(resolveExecutionTarget(undefined, { isDesktop: false, isHetero: true })).toBe('sandbox');
  });
});

describe('executionTargetToRuntimeMode', () => {
  it('maps target → tool gate', () => {
    expect(executionTargetToRuntimeMode('local')).toBe('local');
    expect(executionTargetToRuntimeMode('sandbox')).toBe('cloud');
    expect(executionTargetToRuntimeMode('device')).toBe('none');
    expect(executionTargetToRuntimeMode('none')).toBe('none');
  });
});

describe('resolveRuntimeMode', () => {
  it('derives from the default target when executionTarget is unset', () => {
    // desktop default → local
    expect(resolveRuntimeMode(undefined, true)).toBe('local');
    // web default → none (an unconfigured web agent is plain chat, no run tools)
    expect(resolveRuntimeMode(undefined, false)).toBe('none');
  });

  it('derives from an explicit executionTarget', () => {
    expect(resolveRuntimeMode(cfg({ executionTarget: 'sandbox' }), true)).toBe('cloud');
    expect(resolveRuntimeMode(cfg({ executionTarget: 'device' }), true)).toBe('none');
    expect(resolveRuntimeMode(cfg({ executionTarget: 'local' }), true)).toBe('local');
    expect(resolveRuntimeMode(cfg({ executionTarget: 'none' }), true)).toBe('none');
  });

  it('applies the web `local`→`sandbox` coercion before mapping to runtime mode', () => {
    // executionTarget=local synced from desktop, resolved on web → sandbox → cloud
    expect(resolveRuntimeMode(cfg({ executionTarget: 'local' }), false)).toBe('cloud');
  });
});

describe('resolveExecutionPlan', () => {
  const ONLINE_A = ['device-a'];
  const ONLINE_AB = ['device-a', 'device-b'];

  describe('none — never routes to a device', () => {
    it('stays none even with a bound device and exactly one device online', () => {
      // the historical bug: single-online-device auto-activation used to
      // bypass an explicit `none`
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'none' }),
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none' });
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'none' }),
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none' });
    });
  });

  describe('sandbox — mutually exclusive with devices', () => {
    it('resolves to sandbox regardless of bound / online devices', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'sandbox' }),
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'sandbox' });
    });

    it('survives canUseDevice=false — the sandbox never touches user machines', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'sandbox' }),
          canUseDevice: false,
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'sandbox' });
    });
  });

  describe('device / local — binding and auto-activation', () => {
    it('uses the bound device when online', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'device' }),
          isDesktop: false,
          onlineDeviceIds: ONLINE_AB,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device' });
    });

    it('stays unrouted when the bound device is offline (no silent fallback)', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-x', executionTarget: 'device' }),
          isDesktop: false,
          onlineDeviceIds: ONLINE_AB,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'bound-device-offline' });
    });

    it('auto-activates only when exactly one device is online and nothing is bound', () => {
      const local = cfg({ executionTarget: 'local' });
      expect(
        resolveExecutionPlan({ agencyConfig: local, isDesktop: true, onlineDeviceIds: ONLINE_A }),
      ).toEqual({ deviceId: 'device-a', kind: 'device' });
      expect(
        resolveExecutionPlan({ agencyConfig: local, isDesktop: true, onlineDeviceIds: ONLINE_AB }),
      ).toEqual({ kind: 'device-unrouted', reason: 'ambiguous-online-devices' });
      expect(
        resolveExecutionPlan({ agencyConfig: local, isDesktop: true, onlineDeviceIds: [] }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-online-device' });
    });

    it('treats the desktop default (unset target) as device-capable', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: undefined,
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device' });
    });

    it('resolves the unset web target to none', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: undefined,
          isDesktop: false,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none' });
    });
  });

  describe('requestedDeviceId — explicit per-request override', () => {
    it('forces device routing regardless of the stored target', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'sandbox' }),
          isDesktop: false,
          onlineDeviceIds: ONLINE_AB,
          requestedDeviceId: 'device-b',
        }),
      ).toEqual({ deviceId: 'device-b', kind: 'device' });
    });

    it('wins over the agent-bound device', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'device' }),
          isDesktop: false,
          onlineDeviceIds: ONLINE_AB,
          requestedDeviceId: 'device-b',
        }),
      ).toEqual({ deviceId: 'device-b', kind: 'device' });
    });
  });

  describe('canUseDevice=false — external bot senders', () => {
    it('degrades every device-capable target to none', () => {
      for (const executionTarget of ['local', 'device', 'none'] as const) {
        expect(
          resolveExecutionPlan({
            agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget }),
            canUseDevice: false,
            isDesktop: true,
            onlineDeviceIds: ONLINE_A,
            requestedDeviceId: 'device-a',
          }),
        ).toEqual({ kind: 'none' });
      }
    });
  });

  describe('onlineDeviceIds=undefined — hetero dispatch semantics', () => {
    it('trusts the binding without online checks and never auto-activates', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'device' }),
          isDesktop: false,
          isHetero: true,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device' });
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'device' }),
          isDesktop: false,
          isHetero: true,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device' });
    });

    it('sends hetero non-device targets to the sandbox on the server', () => {
      // server resolves hetero with isDesktop=false: local → sandbox,
      // none → sandbox (hetero coercion), sandbox → sandbox
      for (const executionTarget of ['local', 'none', 'sandbox', undefined] as const) {
        const plan: ExecutionPlan = resolveExecutionPlan({
          agencyConfig: executionTarget ? cfg({ executionTarget }) : undefined,
          isDesktop: false,
          isHetero: true,
        });
        expect(plan).toEqual({ kind: 'sandbox' });
      }
    });
  });
});
