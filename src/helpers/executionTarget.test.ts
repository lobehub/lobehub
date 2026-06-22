import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
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
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'device' }), {
        clientExecutionAvailable: true,
      }),
    ).toBe('device');
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'sandbox' }), {
        clientExecutionAvailable: true,
      }),
    ).toBe('sandbox');
  });

  it('defaults to local on desktop, none on web when unset', () => {
    expect(resolveExecutionTarget(undefined, { clientExecutionAvailable: true })).toBe('local');
    expect(resolveExecutionTarget(undefined, { clientExecutionAvailable: false })).toBe('none');
    expect(resolveExecutionTarget(cfg(), { clientExecutionAvailable: true })).toBe('local');
    expect(resolveExecutionTarget(cfg(), { clientExecutionAvailable: false })).toBe('none');
  });

  it('coerces a stored `local` to `sandbox` on web (no local filesystem)', () => {
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'local' }), {
        clientExecutionAvailable: false,
      }),
    ).toBe('sandbox');
    // …but keeps it on desktop
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'local' }), { clientExecutionAvailable: true }),
    ).toBe('local');
  });

  it('routes hetero desktop-local bindings to the bound device on web', () => {
    expect(
      resolveExecutionTarget(cfg({ boundDeviceId: 'device-a', executionTarget: 'local' }), {
        clientExecutionAvailable: false,
        isHetero: true,
      }),
    ).toBe('device');

    expect(
      resolveExecutionTarget(cfg({ boundDeviceId: 'device-a', executionTarget: 'local' }), {
        clientExecutionAvailable: false,
      }),
    ).toBe('sandbox');
  });

  it('keeps `device` on web (a bound device is reachable from anywhere)', () => {
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'device' }), {
        clientExecutionAvailable: false,
      }),
    ).toBe('device');
  });

  it('keeps an explicit `none` on both platforms', () => {
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'none' }), { clientExecutionAvailable: true }),
    ).toBe('none');
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'none' }), { clientExecutionAvailable: false }),
    ).toBe('none');
  });

  it('coerces `none` for hetero agents — they must execute somewhere', () => {
    // stored none → desktop local, web sandbox
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'none' }), {
        clientExecutionAvailable: true,
        isHetero: true,
      }),
    ).toBe('local');
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'none' }), {
        clientExecutionAvailable: false,
        isHetero: true,
      }),
    ).toBe('sandbox');
    // unset → platform default, then the same coercion on web
    expect(
      resolveExecutionTarget(undefined, { clientExecutionAvailable: true, isHetero: true }),
    ).toBe('local');
    expect(
      resolveExecutionTarget(undefined, { clientExecutionAvailable: false, isHetero: true }),
    ).toBe('sandbox');
  });

  describe('trigger=bot — upgrades a local target (bound → device, unbound → auto)', () => {
    it('coerces an UNBOUND desktop `local` (and the unset desktop default) to auto', () => {
      expect(
        resolveExecutionTarget(cfg({ executionTarget: 'local' }), {
          clientExecutionAvailable: true,
          trigger: RequestTrigger.Bot,
        }),
      ).toBe('auto');
      // unset desktop default is `local`, so it coerces too
      expect(
        resolveExecutionTarget(undefined, {
          clientExecutionAvailable: true,
          trigger: RequestTrigger.Bot,
        }),
      ).toBe('auto');
    });

    it('routes a BOUND `local` to `device` — honours the pinned machine, not auto', () => {
      // the switcher persists the desktop's own deviceId as boundDeviceId for a
      // `local` pick; a bot run must reach THAT machine, not auto-grab another.
      expect(
        resolveExecutionTarget(cfg({ boundDeviceId: 'device-a', executionTarget: 'local' }), {
          clientExecutionAvailable: true,
          trigger: RequestTrigger.Bot,
        }),
      ).toBe('device');
    });

    it('leaves `none` / `sandbox` / `device` untouched — explicit intent', () => {
      for (const executionTarget of ['none', 'sandbox', 'device'] as const) {
        expect(
          resolveExecutionTarget(cfg({ executionTarget }), {
            clientExecutionAvailable: true,
            trigger: RequestTrigger.Bot,
          }),
        ).toBe(executionTarget);
      }
    });

    it('does not resurrect a device on web — `local` still coerces to sandbox first', () => {
      // the web→sandbox coercion runs before the bot rule, so a web `local`
      // never becomes auto (there is no in-process local on web anyway).
      expect(
        resolveExecutionTarget(cfg({ executionTarget: 'local' }), {
          clientExecutionAvailable: false,
          trigger: RequestTrigger.Bot,
        }),
      ).toBe('sandbox');
    });

    it('only fires for the bot trigger — other triggers keep `local`', () => {
      for (const trigger of [RequestTrigger.Chat, RequestTrigger.Cron, undefined]) {
        expect(
          resolveExecutionTarget(cfg({ executionTarget: 'local' }), {
            clientExecutionAvailable: true,
            trigger,
          }),
        ).toBe('local');
      }
    });
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
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'none' }),
          clientExecutionAvailable: true,
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
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'sandbox', target: 'sandbox' });
    });

    it('survives canUseDevice=false — the sandbox never touches user machines', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'sandbox' }),
          canUseDevice: false,
          clientExecutionAvailable: true,
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
          clientExecutionAvailable: false,
          onlineDeviceIds: ONLINE_AB,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
    });

    it('stays unrouted when the bound device is offline (no silent fallback)', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-x', executionTarget: 'device' }),
          clientExecutionAvailable: false,
          onlineDeviceIds: ONLINE_AB,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'bound-device-offline', target: 'device' });
    });

    it('NEVER auto-activates a `local` target with nothing bound (no silent grab)', () => {
      const local = cfg({ executionTarget: 'local' });
      // a single online device used to be auto-activated for `local`; now only
      // `auto` does that — `local` stays unrouted until a device is bound.
      expect(
        resolveExecutionPlan({
          agencyConfig: local,
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'local' });
      expect(
        resolveExecutionPlan({
          agencyConfig: local,
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_AB,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'local' });
    });

    it('treats the desktop default (unset target) as `local` but never auto-grabs a device', () => {
      // unset → `local` on desktop; device-capable but unrouted until bound.
      expect(
        resolveExecutionPlan({
          agencyConfig: undefined,
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'local' });
    });

    it('resolves the unset web target to none', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: undefined,
          clientExecutionAvailable: false,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
    });
  });

  describe('auto — the only mode that auto-activates an unbound device', () => {
    const auto = cfg({ executionTarget: 'auto' });

    it('activates the single online device', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: auto,
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'auto' });
    });

    it('stays unrouted (model picks) when several devices are online', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: auto,
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_AB,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'ambiguous-online-devices', target: 'auto' });
    });

    it('stays unrouted when no device is online', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: auto,
          clientExecutionAvailable: true,
          onlineDeviceIds: [],
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-online-device', target: 'auto' });
    });

    it('works on web too (auto can pick a remote device)', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: auto,
          clientExecutionAvailable: false,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'auto' });
    });

    it('ignores a stale stored boundDeviceId (auto is not an explicit selection)', () => {
      // a leftover binding from a previous `device` selection must not pin the
      // run — auto picks fresh from the online set.
      const staleBound = cfg({ boundDeviceId: 'device-a', executionTarget: 'auto' });
      expect(
        resolveExecutionPlan({
          agencyConfig: staleBound,
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_AB,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'ambiguous-online-devices', target: 'auto' });
    });

    it('still honours an explicit requestedDeviceId over auto-pick', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: auto,
          clientExecutionAvailable: true,
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
          clientExecutionAvailable: false,
          onlineDeviceIds: ONLINE_AB,
          requestedDeviceId: 'device-b',
        }),
      ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'device' });
    });

    it('wins over the agent-bound device', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'device' }),
          clientExecutionAvailable: false,
          onlineDeviceIds: ONLINE_AB,
          requestedDeviceId: 'device-b',
        }),
      ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'device' });
    });
  });

  describe('trigger=bot — upgrades a local target to auto', () => {
    it('upgrades a stored `local` target to auto and activates the single online device', () => {
      // a bot conversation can't pick a device, and `local` in-process IPC is
      // unreachable from the cloud bot server — so `local` auto-activates.
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'local' }),
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'auto' });
    });

    it('upgrades the unset desktop default (local) to auto', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: undefined,
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'auto' });
    });

    it('stays unrouted (model picks) when several devices are online', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'local' }),
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_AB,
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'ambiguous-online-devices', target: 'auto' });
    });

    it('routes a BOUND `local` to its pinned device, even with several online (no auto-grab)', () => {
      // regression: the bot upgrade used to relabel bound `local` → auto, which
      // ignores boundDeviceId and would auto-pick / go ambiguous. A pinned
      // machine must win — here device-b is bound and stays selected.
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-b', executionTarget: 'local' }),
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_AB,
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'device' });
    });

    it('keeps a BOUND `local` on its pinned device when offline (no silent fallback)', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-x', executionTarget: 'local' }),
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_AB,
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'bound-device-offline', target: 'device' });
    });

    it('does NOT upgrade `none` — an explicit opt-out stays plain chat', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'none' }),
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
    });

    it('does NOT upgrade `sandbox` — an explicit cloud choice stays', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'sandbox' }),
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ kind: 'sandbox', target: 'sandbox' });
    });

    it('does NOT touch an explicitly bound `device` target (binding wins over auto)', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-b', executionTarget: 'device' }),
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_AB,
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'device' });
    });

    it('still routes a requestedDeviceId-pinned local run to that device (now under auto)', () => {
      // the local→auto coercion lives in resolveExecutionTarget, so it applies
      // before requestedDeviceId is considered. The explicit device still wins
      // the routing; only the target label is `auto` (gateway routing) rather
      // than `local` (in-process) — correct for a server-side bot run.
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'local' }),
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_AB,
          requestedDeviceId: 'device-b',
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'auto' });
    });

    it('still honours chat mode — a bot on a chat-mode agent stays plain chat', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'local' }),
          chatConfig: { enableAgentMode: false },
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
          trigger: RequestTrigger.Bot,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
    });

    it('only fires for bot triggers — a chat trigger leaves `local` unrouted', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'local' }),
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
          trigger: RequestTrigger.Chat,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'local' });
    });
  });

  describe('canUseDevice=false — external bot senders', () => {
    it('degrades every device-capable target to none', () => {
      for (const executionTarget of ['local', 'device', 'none'] as const) {
        expect(
          resolveExecutionPlan({
            agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget }),
            canUseDevice: false,
            clientExecutionAvailable: true,
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
              clientExecutionAvailable: true,
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
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'sandbox' }),
          chatConfig: { enableAgentMode: false },
          clientExecutionAvailable: true,
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
          clientExecutionAvailable: true,
          onlineDeviceIds: ONLINE_A,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'auto' });
    });

    it('ignores chat mode for hetero agents (they always need a runtime)', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'device' }),
          chatConfig: { enableAgentMode: false },
          clientExecutionAvailable: false,
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
            clientExecutionAvailable: false,
            isHetero: true,
          }),
        ).toEqual({ kind: 'sandbox', target: 'sandbox' });
      }
      // requestedDeviceId must not bypass the policy either
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'sandbox' }),
          canUseDevice: false,
          clientExecutionAvailable: false,
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
          clientExecutionAvailable: false,
          isHetero: true,
        }),
      ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ executionTarget: 'device' }),
          clientExecutionAvailable: false,
          isHetero: true,
        }),
      ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'device' });
    });

    it('uses the bound desktop device for hetero local runs entered from web', () => {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'local' }),
          clientExecutionAvailable: false,
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
          clientExecutionAvailable: false,
          isHetero: true,
        });
        expect(plan).toEqual({ kind: 'sandbox', target: 'sandbox' });
      }
    });
  });
});
