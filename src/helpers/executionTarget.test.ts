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

  it('routes hetero desktop-local bindings to the bound device on web', () => {
    expect(
      resolveExecutionTarget(cfg({ boundDeviceId: 'device-a', executionTarget: 'local' }), {
        isDesktop: false,
        isHetero: true,
      }),
    ).toBe('device');

    expect(
      resolveExecutionTarget(cfg({ boundDeviceId: 'device-a', executionTarget: 'local' }), {
        isDesktop: false,
      }),
    ).toBe('sandbox');
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
      ).toEqual({ kind: 'none', target: 'none' });
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'none' }),
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
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
      ).toEqual({ kind: 'sandbox', target: 'sandbox' });
    });

    it('survives canUseDevice=false — the sandbox never touches user machines', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'sandbox' }),
          canUseDevice: false,
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'sandbox', target: 'sandbox' });
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
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
    });

    it('stays unrouted when the bound device is offline (no silent fallback)', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-x', executionTarget: 'device' }),
          isDesktop: false,
          onlineDeviceIds: ONLINE_AB,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'bound-device-offline', target: 'device' });
    });

    it('NEVER auto-activates a `local` target with nothing bound (no silent grab)', () => {
      const local = cfg({ executionTarget: 'local' });
      // a single online device used to be auto-activated for `local`; now only
      // `auto` does that — `local` stays unrouted until a device is bound.
      expect(
        resolveExecutionPlan({ agencyConfig: local, isDesktop: true, onlineDeviceIds: ONLINE_A }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'local' });
      expect(
        resolveExecutionPlan({ agencyConfig: local, isDesktop: true, onlineDeviceIds: ONLINE_AB }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'local' });
    });

    it('treats the desktop default (unset target) as `local` but never auto-grabs a device', () => {
      // unset → `local` on desktop; device-capable but unrouted until bound.
      expect(
        resolveExecutionPlan({
          agencyConfig: undefined,
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'local' });
    });

    it('resolves the unset web target to none', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: undefined,
          isDesktop: false,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
    });
  });

  describe('auto — the only mode that auto-activates an unbound device', () => {
    const auto = cfg({ executionTarget: 'auto' });

    it('activates the single online device', () => {
      expect(
        resolveExecutionPlan({ agencyConfig: auto, isDesktop: true, onlineDeviceIds: ONLINE_A }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'auto' });
    });

    it('stays unrouted (model picks) when several devices are online', () => {
      expect(
        resolveExecutionPlan({ agencyConfig: auto, isDesktop: true, onlineDeviceIds: ONLINE_AB }),
      ).toEqual({ kind: 'device-unrouted', reason: 'ambiguous-online-devices', target: 'auto' });
    });

    it('stays unrouted when no device is online', () => {
      expect(
        resolveExecutionPlan({ agencyConfig: auto, isDesktop: true, onlineDeviceIds: [] }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-online-device', target: 'auto' });
    });

    it('works on web too (auto can pick a remote device)', () => {
      expect(
        resolveExecutionPlan({ agencyConfig: auto, isDesktop: false, onlineDeviceIds: ONLINE_A }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'auto' });
    });

    it('ignores a stale stored boundDeviceId (auto is not an explicit selection)', () => {
      // a leftover binding from a previous `device` selection must not pin the
      // run — auto picks fresh from the online set.
      const staleBound = cfg({ boundDeviceId: 'device-a', executionTarget: 'auto' });
      expect(
        resolveExecutionPlan({
          agencyConfig: staleBound,
          isDesktop: true,
          onlineDeviceIds: ONLINE_AB,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'ambiguous-online-devices', target: 'auto' });
    });

    it('still honours an explicit requestedDeviceId over auto-pick', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: auto,
          isDesktop: true,
          onlineDeviceIds: ONLINE_AB,
          requestedDeviceId: 'device-b',
        }),
      ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'auto' });
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
      ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'device' });
    });

    it('wins over the agent-bound device', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'device' }),
          isDesktop: false,
          onlineDeviceIds: ONLINE_AB,
          requestedDeviceId: 'device-b',
        }),
      ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'device' });
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
        ).toEqual({ kind: 'none', target: 'none' });
      }
    });
  });

  describe('chat mode — no execution environment, even on a local target', () => {
    it('degrades every device-capable target to none despite an online device', () => {
      // regression: chat mode only removes local-system from the rule-layer
      // whitelist; the device track resolved an `activeDeviceId` from the
      // default/stored `local` target and `buildStepToolDelta` re-injected
      // local-system. The plan now honours chat mode at the source.
      for (const executionTarget of ['local', 'device'] as const) {
        // both ways of expressing chat mode degrade the plan
        for (const chatConfig of [{ enableAgentMode: false }, { toolMode: 'chat' as const }]) {
          expect(
            resolveExecutionPlan({
              agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget }),
              chatConfig,
              isDesktop: true,
              onlineDeviceIds: ONLINE_A,
            }),
          ).toEqual({ kind: 'none', target: 'none' });
        }
      }
    });

    it('degrades the unset desktop default (local) and sandbox to none', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: undefined,
          chatConfig: { enableAgentMode: false },
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'sandbox' }),
          chatConfig: { enableAgentMode: false },
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
    });

    it('does not degrade agent mode (toolMode wins over enableAgentMode)', () => {
      // explicit toolMode='agent' must keep device routing even if
      // enableAgentMode is somehow false. Uses `auto` so a single online device
      // is still activated — proving the device track survives agent mode (only
      // `auto` auto-activates; `local`'s no-grab behaviour is covered above).
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'auto' }),
          chatConfig: { enableAgentMode: false, toolMode: 'agent' },
          isDesktop: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'auto' });
    });

    it('ignores chat mode for hetero agents (they always need a runtime)', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'device' }),
          chatConfig: { enableAgentMode: false },
          isDesktop: false,
          isHetero: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
    });
  });

  describe('canUseDevice=false — hetero degrades to sandbox, never a machine', () => {
    it('sends denied hetero device-capable targets to the sandbox', () => {
      // regression: the hetero early-dispatch used to omit the policy, so an
      // external bot sender could run on the owner's bound machine via a
      // synced local/device binding
      for (const executionTarget of ['local', 'device'] as const) {
        expect(
          resolveExecutionPlan({
            agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget }),
            canUseDevice: false,
            isDesktop: false,
            isHetero: true,
          }),
        ).toEqual({ kind: 'sandbox', target: 'sandbox' });
      }
      // requestedDeviceId must not bypass the policy either
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'sandbox' }),
          canUseDevice: false,
          isDesktop: false,
          isHetero: true,
          requestedDeviceId: 'device-a',
        }),
      ).toEqual({ kind: 'sandbox', target: 'sandbox' });
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
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'device' }),
          isDesktop: false,
          isHetero: true,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'device' });
    });

    it('uses the bound desktop device for hetero local runs entered from web', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'local' }),
          isDesktop: false,
          isHetero: true,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
    });

    it('sends hetero non-device targets to the sandbox on the server', () => {
      // server resolves hetero with isDesktop=false: unbound local → sandbox,
      // none → sandbox (hetero coercion), sandbox → sandbox
      for (const executionTarget of ['local', 'none', 'sandbox', undefined] as const) {
        const plan: ExecutionPlan = resolveExecutionPlan({
          agencyConfig: executionTarget ? cfg({ executionTarget }) : undefined,
          isDesktop: false,
          isHetero: true,
        });
        expect(plan).toEqual({ kind: 'sandbox', target: 'sandbox' });
      }
    });
  });
});
