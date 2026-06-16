import type {
  DeviceExecutionTarget,
  LobeAgentAgencyConfig,
  LobeAgentChatConfig,
  RuntimeEnvMode,
} from '@lobechat/types';

/**
 * The agent's tool mode — explicit `chatConfig.toolMode` wins; otherwise derive
 * from `enableAgentMode` (undefined = agent). `chat` = no execution
 * environment (plain chat); `custom` = toolset is exactly the agent's plugins.
 *
 * Single source of truth so client (selectors), server tools engine, and
 * `resolveExecutionPlan` all agree on what counts as chat mode.
 */
export const resolveToolMode = (
  chatConfig: LobeAgentChatConfig | undefined,
): 'agent' | 'chat' | 'custom' =>
  chatConfig?.toolMode ?? (chatConfig?.enableAgentMode === false ? 'chat' : 'agent');

export interface ResolveExecutionTargetOptions {
  /**
   * Platform of the resolving side. On the server there is no real "desktop"
   * flag — callers pass `gatewayConfigured` as a proxy (a device-gateway
   * deployment serves desktop-class users). See `resolveExecutionPlan`.
   */
  isDesktop: boolean;
  /**
   * Heterogeneous agents (Claude Code / Codex) bring their own toolchain and
   * must execute somewhere, so `'none'` is not a valid target for them: it
   * coerces to `'local'` on desktop and `'sandbox'` on web.
   */
  isHetero?: boolean;
}

/**
 * Single source of truth for where an agent executes — one global
 * `agencyConfig.executionTarget` drives both desktop and web.
 *
 * - `none`    → no execution environment (plain chat)
 * - `auto`    → auto-pick a device (opt-in; the only mode that activates a
 *               device the user did not explicitly select)
 * - `local`   → this machine (in-process; desktop only)
 * - `sandbox` → server cloud sandbox
 * - `device`  → remote device (dispatched to `boundDeviceId`)
 *
 * `local` and `device` stay DISTINCT even when the bound device is this very
 * machine: `device` dispatches through the server gateway, so progress streams
 * to every client (mobile/web can follow the run); `local` is the faster
 * in-process IPC path whose run lives only in this desktop session. Which one
 * to use is the user's observability/latency trade-off — never auto-collapse
 * `device(currentDeviceId)` into the in-process path.
 *
 * Defaults: desktop → `local`, web → `none`. On web `local` isn't available
 * (no local filesystem), so a stored `local` (synced from desktop) usually
 * resolves to `sandbox`. For heterogeneous CLI agents, a desktop `local`
 * selection that has already been bound to that desktop's `deviceId` resolves
 * to `device` on web, so the same machine can execute through `lh connect`.
 */
export const resolveExecutionTarget = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  { isDesktop, isHetero }: ResolveExecutionTargetOptions,
): DeviceExecutionTarget => {
  const stored = agencyConfig?.executionTarget;
  let effective = stored ?? (isDesktop ? 'local' : 'none');
  if (isHetero && !isDesktop && stored === 'local' && agencyConfig?.boundDeviceId) {
    return 'device';
  }
  if (isHetero && effective === 'none') effective = isDesktop ? 'local' : 'sandbox';
  if (!isDesktop && effective === 'local') return 'sandbox';
  return effective;
};

/**
 * Derive the `runtimeMode` tool gate from the unified execution target:
 * `local` → local-system tools, `sandbox` → cloud sandbox, `device`/`auto` →
 * gateway routing, `none` → no run tools (plain chat). `device`/`auto`/`none`
 * all gate to `'none'` — device tools are routed via `resolveExecutionPlan`,
 * not via runtimeMode.
 */
export const executionTargetToRuntimeMode = (target: DeviceExecutionTarget): RuntimeEnvMode => {
  switch (target) {
    case 'local': {
      return 'local';
    }
    case 'sandbox': {
      return 'cloud';
    }
    default: {
      return 'none';
    }
  }
};

/**
 * The effective `runtimeMode` (server tool gate) from the unified execution
 * target.
 */
export const resolveRuntimeMode = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  isDesktop: boolean,
): RuntimeEnvMode =>
  executionTargetToRuntimeMode(resolveExecutionTarget(agencyConfig, { isDesktop }));

export type ExecutionPlanUnroutedReason =
  /** `auto` mode with more than one device online — the model must pick one */
  | 'ambiguous-online-devices'
  /** an explicitly bound device exists but is offline — never silently fall back */
  | 'bound-device-offline'
  /**
   * device-capable target (`auto` / `local` / `device`) but no device selected —
   * nothing bound/requested, and not the `auto` single-online-device case
   */
  | 'no-bound-device'
  /** `auto` mode but no device online at all */
  | 'no-online-device';

/**
 * Where (and whether) a run executes, resolved ONCE at the entry point.
 * Downstream layers consume the plan instead of re-deriving the answer from
 * `executionTarget` / `boundDeviceId` / online state themselves.
 *
 * `target` is the EFFECTIVE execution target (platform defaults and coercions
 * applied; degraded to `none` when device access is denied) — consumers must
 * read it instead of re-resolving `agencyConfig.executionTarget`.
 */
export type ExecutionPlan = { target: DeviceExecutionTarget } &
  /** route execution / device tools to this device (the local machine is a registered device) */
  (| { deviceId: string; kind: 'device' }
    /**
     * Device-targeted but no routable device right now. The run proceeds without
     * an active device; the remote-device proxy may let the model activate one
     * mid-run (native agents), or the caller may treat this as a hard error
     * (hetero dispatch).
     */
    | { kind: 'device-unrouted'; reason: ExecutionPlanUnroutedReason }
    /** plain chat — no execution environment, no run tools, no device ever */
    | { kind: 'none' }
    /** ephemeral cloud sandbox */
    | { kind: 'sandbox' }
  );

/** Device tools (local-system / remote-device proxy) only exist in device-capable sessions. */
export const isDeviceCapablePlan = (plan: ExecutionPlan): boolean =>
  plan.kind === 'device' || plan.kind === 'device-unrouted';

export interface ResolveExecutionPlanParams {
  agencyConfig: LobeAgentAgencyConfig | undefined;
  /**
   * Verdict of `resolveDeviceAccessPolicy` — `false` (e.g. an external bot
   * sender) kills device routing entirely but does NOT block the sandbox.
   * Defaults to `true` (first-party callers).
   */
  canUseDevice?: boolean;
  /**
   * The agent's chat config. Chat mode (`resolveToolMode` → `chat`) means "no
   * execution environment" — plain chat. It is orthogonal to `executionTarget`:
   * the UI toggle only writes `enableAgentMode` and never touches the target, so
   * a stored/default `local` target would otherwise still resolve a device and
   * `buildStepToolDelta` would re-inject local-system. The plan honours chat
   * mode at the source (degraded to `none`) — except for hetero agents, which
   * always need a runtime.
   */
  chatConfig?: LobeAgentChatConfig;
  isDesktop: boolean;
  isHetero?: boolean;
  /**
   * Online device ids from the device gateway. Pass `undefined` to skip
   * online checks and single-device auto-activation entirely — the binding is
   * trusted as-is and dispatch fails loudly if the device is offline (hetero
   * dispatch semantics).
   */
  onlineDeviceIds?: string[];
  /**
   * Explicit per-request device override (e.g. the desktop preset, or a
   * batch-task `deviceId`). Always wins: it forces device routing regardless
   * of the stored target.
   */
  requestedDeviceId?: string;
}

/**
 * Resolve the execution plan for a run. This is THE device decision — every
 * rule about which device (if any) a run touches lives here:
 *
 * 1. `requestedDeviceId` forces device routing; otherwise the resolved
 *    `executionTarget` decides (`auto` / `local` route to a device too — the
 *    local machine is just a device).
 * 2. `none` / `sandbox` NEVER route to a device — no auto-activation, no
 *    step-level re-injection, no exceptions.
 * 3. `canUseDevice === false` degrades any device-capable target to `none`
 *    (sandbox stays available — it never touches the user's machines).
 * 4. With online info: a bound device is used only if online (an offline
 *    binding stays unrouted rather than guessing another machine). An UNBOUND
 *    run auto-activates ONLY in the opt-in `auto` mode (single device → use it;
 *    several → stay unrouted so the model picks one). `local` / `device` never
 *    silently grab a device — they stay unrouted until one is bound/requested.
 */
export const resolveExecutionPlan = (params: ResolveExecutionPlanParams): ExecutionPlan => {
  const {
    agencyConfig,
    canUseDevice = true,
    chatConfig,
    isDesktop,
    isHetero,
    onlineDeviceIds,
    requestedDeviceId,
  } = params;

  // Chat mode = no execution environment (plain chat). It's orthogonal to the
  // execution target, so collapse the whole plan to `none` here — this is the
  // single point that stops a default/stored `local` target from resolving a
  // device and letting `buildStepToolDelta` re-inject local-system. Hetero
  // agents always need a runtime, so they never take this path.
  if (resolveToolMode(chatConfig) === 'chat' && !isHetero) return { kind: 'none', target: 'none' };

  const target = resolveExecutionTarget(agencyConfig, { isDesktop, isHetero });
  const wantsDevice =
    !!requestedDeviceId || target === 'device' || target === 'local' || target === 'auto';

  if (!wantsDevice || !canUseDevice) {
    if (target === 'sandbox') return { kind: 'sandbox', target: 'sandbox' };
    // Hetero agents must execute somewhere — a device-capable target denied
    // by the access policy falls back to the cloud sandbox (which never
    // touches user machines) instead of the hetero-invalid `none`.
    if (isHetero) return { kind: 'sandbox', target: 'sandbox' };
    // a device-capable target denied by the access policy degrades to plain
    // chat — the effective target is `none`, not the stored one
    return { kind: 'none', target: 'none' };
  }

  // In `auto` mode a stored `boundDeviceId` is NOT an explicit selection (that
  // is what `device` mode is for) — ignore it so `auto` always picks fresh and
  // a stale binding left over from a previous `device` selection can't pin the
  // run. An explicit `requestedDeviceId` still wins everywhere.
  const boundDeviceId =
    requestedDeviceId || (target === 'auto' ? undefined : agencyConfig?.boundDeviceId);
  // requestedDeviceId may force device routing over a non-device stored target;
  // keep `auto` / `local` distinct, everything else collapses to `device`.
  const effectiveTarget = target === 'local' ? 'local' : target === 'auto' ? 'auto' : 'device';

  // No online info: trust the binding (the gateway errors on dispatch if the
  // device is offline). No auto-activation without visibility.
  if (!onlineDeviceIds) {
    if (boundDeviceId) return { deviceId: boundDeviceId, kind: 'device', target: effectiveTarget };
    return { kind: 'device-unrouted', reason: 'no-bound-device', target: effectiveTarget };
  }

  if (boundDeviceId) {
    return onlineDeviceIds.includes(boundDeviceId)
      ? { deviceId: boundDeviceId, kind: 'device', target: effectiveTarget }
      : { kind: 'device-unrouted', reason: 'bound-device-offline', target: effectiveTarget };
  }

  // Unbound. Auto-activation — picking a device the user never selected — is
  // exclusive to the opt-in `auto` mode: one online device is used directly;
  // with several, stay unrouted so the model selects one via the remote-device
  // tool.
  if (target === 'auto') {
    if (onlineDeviceIds.length === 1) {
      return { deviceId: onlineDeviceIds[0], kind: 'device', target: effectiveTarget };
    }
    return {
      kind: 'device-unrouted',
      reason: onlineDeviceIds.length === 0 ? 'no-online-device' : 'ambiguous-online-devices',
      target: effectiveTarget,
    };
  }

  // `local` / `device` with nothing bound: never auto-grab a device — stay
  // unrouted until the user binds/requests one (or switches to `auto`).
  return { kind: 'device-unrouted', reason: 'no-bound-device', target: effectiveTarget };
};
