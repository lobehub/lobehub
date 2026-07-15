import type {
  DeviceExecutionTarget,
  LobeAgentAgencyConfig,
  LobeAgentChatConfig,
  RuntimeEnvMode,
} from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

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
   * Whether tools can run on the user's own client/device in this environment —
   * i.e. the `local` target (`runtimeMode: 'local'`, the `'client'` executor)
   * has somewhere to run. This is the boolean form of `RuntimePlatform`
   * (`'desktop'` vs `'web'`); it is NOT "the build is desktop" and NOT "the
   * message came from a desktop client". It is true for:
   *   - the Electron desktop build (the client runs tools in-process), and
   *   - a server with a device gateway (`!!DEVICE_GATEWAY_URL`), which tunnels
   *     the run to a registered device — the client lives at the other end.
   * When false (plain web / a server with no gateway) there is no client to run
   * on, so a `local` target coerces to `sandbox` (cloud) or the default is
   * `none` (plain chat). Each layer passes the value that means this for it:
   * `isDesktop` (build const) in the UI, `gatewayConfigured` on the server,
   * `hasDeviceProxy` in the tools engine.
   *
   * Note this gates only `local` — `device` (an explicit `boundDeviceId`) is a
   * concrete remote target reachable from anywhere, so it is honoured even when
   * this is false.
   */
  clientExecutionAvailable: boolean;
  /**
   * Whether a device-gateway can route the run to a registered device in this
   * environment. Orthogonal to {@link clientExecutionAvailable} (in-process
   * `local` capability): the two coincide on a server (both equal
   * `gatewayConfigured`), but split on the web client — the browser can't run
   * `local` in-process (`clientExecutionAvailable` false) yet its backend may
   * still have a device-gateway that routes to a `lh connect`-ed machine
   * (`deviceRoutingAvailable` true).
   *
   * Gates ONLY the web-display upgrade of a bound `local` target to `device`
   * (see `resolveExecutionTarget`). Server execution never relies on it: with a
   * gateway `clientExecutionAvailable` is already true (branch skipped, `local`
   * routes to a device via `resolveExecutionPlan`); without one the target must
   * stay `sandbox`. So server callers leave it `undefined` (false) and the
   * branch is a no-op there — only web display sites pass
   * `!!serverConfig.agentGatewayUrl` to keep the honest device display
   * (LOBE-11473). `isHetero` also satisfies the gate: a hetero agent's bound
   * `local` was always surfaced as `device` on web regardless of gateway state.
   */
  deviceRoutingAvailable?: boolean;
  /**
   * Heterogeneous agents bring their own toolchain and must execute somewhere,
   * so `'none'` normally coerces to `'local'` on desktop and `'sandbox'` on
   * web. A provider without sandbox support keeps `'none'` as a pending device
   * selection instead.
   */
  isHetero?: boolean;
  /**
   * Whether this heterogeneous provider can execute in the server cloud
   * sandbox. Defaults to `false` for Amp (which currently requires a local or
   * connected device) and `true` otherwise. Callers that only know the provider
   * through a legacy model discriminator can override the inferred capability.
   */
  sandboxExecutionAvailable?: boolean;
  /**
   * What initiated the run. A `bot` trigger has no UI to pick a device, and
   * `local` (in-process IPC) is unreachable from the cloud bot server — so a
   * stored `local` target is upgraded: to `device` when it carries a
   * `boundDeviceId` (route to the pinned machine), otherwise to `auto`
   * (auto-activate an online device). `none` / `sandbox` are explicit opt-outs
   * and are left untouched.
   */
  trigger?: RequestTrigger;
  /**
   * The agent belongs to a workspace (`agent.workspaceId` is set). Every
   * member runs a workspace agent through the shared device pool, so the
   * CURRENT member's own client is never a valid execution host — `local`
   * would silently run the shared agent on whichever personal machine opened
   * it. Treats client execution as unavailable: an unset target no longer
   * defaults to `local`, and a stored `local` (synced from before the agent
   * joined the workspace) coerces to `sandbox` when supported (otherwise
   * `none`) — or, for hetero agents, to `device` when a (grandfathered)
   * `boundDeviceId` pins a machine, matching the write-time guard in
   * `AgentModel.assertWorkspaceDeviceBinding`.
   */
  workspaceScoped?: boolean;
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
 * (no local filesystem). A desktop `local` pick pins that desktop's own
 * `deviceId` as `boundDeviceId` (see `useSelectExecutionTarget`), and the
 * server routes such a config to that bound device — so on web we resolve it
 * to `device`, surfacing honestly that it runs on the user's machine (via
 * `lh connect`) instead of masquerading as `sandbox`. This applies to plain
 * agents too, not just heterogeneous CLI agents (LOBE-11473: plain agents used
 * to leak here, showing "cloud sandbox" while the server ran on the device).
 *
 * This upgrade is gated on `deviceRoutingAvailable` (or `isHetero`): the run
 * can only reach the bound device if a device-gateway exists to route it. Web
 * display sites pass `!!serverConfig.agentGatewayUrl` (cloud always has one);
 * a no-gateway self-host has no route, so its bound `local` stays `sandbox`
 * when the provider supports it. An UNBOUND `local` (no `boundDeviceId`) falls
 * back to `sandbox` on web, or to the pending `none` state for device-only
 * providers.
 * Server callers leave `deviceRoutingAvailable` unset — with a gateway they
 * already pass `clientExecutionAvailable: true` and skip this branch, so it is
 * inert server-side and never diverts a no-gateway run away from `sandbox`.
 *
 * Bot triggers (`trigger === bot`) upgrade a `local` target (a bot has no UI
 * to pick a device and `local` in-process IPC is unreachable from the cloud
 * bot server): to `device` when a `boundDeviceId` pins a specific machine,
 * otherwise to `auto` to auto-activate an online device. `none` / `sandbox`
 * are explicit opt-outs and stay.
 */
export const resolveExecutionTarget = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  {
    clientExecutionAvailable,
    deviceRoutingAvailable,
    isHetero,
    sandboxExecutionAvailable,
    trigger,
    workspaceScoped,
  }: ResolveExecutionTargetOptions,
): DeviceExecutionTarget => {
  // A workspace agent never executes on the current member's own client — see
  // `workspaceScoped` above. Same coercions as a client-less environment.
  const clientAvailable = clientExecutionAvailable && !workspaceScoped;
  const sandboxAvailable =
    sandboxExecutionAvailable ?? agencyConfig?.heterogeneousProvider?.type !== 'amp';
  const stored = agencyConfig?.executionTarget;
  let effective = stored ?? (clientAvailable ? 'local' : 'none');
  if (
    !clientAvailable &&
    (isHetero || deviceRoutingAvailable) &&
    stored === 'local' &&
    agencyConfig?.boundDeviceId
  ) {
    return 'device';
  }
  if (isHetero && effective === 'none') {
    if (clientAvailable) effective = 'local';
    else if (sandboxAvailable) effective = 'sandbox';
  }
  // Never leave an unsupported sandbox target active. `none` is a pending
  // selection for hetero providers without cloud execution: the UI blocks the
  // run and prompts for a local or connected device.
  if (!sandboxAvailable && effective === 'sandbox') effective = 'none';
  if (!clientAvailable && effective === 'local') return sandboxAvailable ? 'sandbox' : 'none';
  // Bot trigger: a `local` target can't run in-process from the cloud bot
  // server, so it has to reach a real device. If the user pinned a specific
  // machine (the switcher persists that desktop's own `deviceId` as
  // `boundDeviceId` for a `local` pick), honour it as `device` — `auto` would
  // ignore the binding and could grab a different online device, or go
  // ambiguous with several. Only an UNBOUND `local` auto-activates. Sits after
  // the web→sandbox coercion, so `effective` is only still `local` when a
  // client/device can actually run it here.
  if (trigger === RequestTrigger.Bot && effective === 'local') {
    return agencyConfig?.boundDeviceId ? 'device' : 'auto';
  }
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
  clientExecutionAvailable: boolean,
  deviceRoutingAvailable?: boolean,
  workspaceScoped?: boolean,
): RuntimeEnvMode =>
  executionTargetToRuntimeMode(
    resolveExecutionTarget(agencyConfig, {
      clientExecutionAvailable,
      deviceRoutingAvailable,
      workspaceScoped,
    }),
  );

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
  (
    | { deviceId: string; kind: 'device' }
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

/**
 * The run is committed to ONE device: either already routed (`device`, which
 * includes the opt-in `auto` single-online activation) or locked to an
 * explicit binding that is currently offline (`bound-device-offline` waits for
 * that machine rather than hopping elsewhere). A locked run has no device
 * decision left, so the remote-device picker must not exist for it — not even
 * as an activator-discoverable manifest, since `allowExplicitActivation`
 * bypasses the rule-layer gates. The picker exists only in the complement:
 * unrouted runs that still need a selection (`no-bound-device` /
 * `ambiguous-online-devices` / `no-online-device`).
 */
export const isDeviceLockedPlan = (plan: ExecutionPlan): boolean =>
  plan.kind === 'device' ||
  (plan.kind === 'device-unrouted' && plan.reason === 'bound-device-offline');

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
  /** See {@link ResolveExecutionTargetOptions.clientExecutionAvailable}. */
  clientExecutionAvailable: boolean;
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
  /** See {@link ResolveExecutionTargetOptions.sandboxExecutionAvailable}. */
  sandboxExecutionAvailable?: boolean;
  /**
   * What initiated this run. Bot triggers have no UI to pick a device, so a
   * stored `local` target (in-process IPC, unreachable from the cloud bot
   * server) is upgraded to `auto` and auto-activates an online device. `none`
   * and `sandbox` are deliberate opt-outs and are left untouched. See
   * `resolveExecutionPlan`.
   */
  trigger?: RequestTrigger;
  /** See {@link ResolveExecutionTargetOptions.workspaceScoped}. */
  workspaceScoped?: boolean;
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
 * Bot triggers coerce a `local` target to `auto` upstream in
 * `resolveExecutionTarget` (not here) — by the time the plan resolves, a bot
 * run already carries `target: 'auto'` and follows the auto-activation rules
 * above. `none` / `sandbox` stay as the owner's explicit opt-out.
 */
export const resolveExecutionPlan = (params: ResolveExecutionPlanParams): ExecutionPlan => {
  const {
    agencyConfig,
    canUseDevice = true,
    chatConfig,
    clientExecutionAvailable,
    isHetero,
    onlineDeviceIds,
    requestedDeviceId,
    sandboxExecutionAvailable,
    trigger,
    workspaceScoped,
  } = params;

  // Chat mode = no execution environment (plain chat). It's orthogonal to the
  // execution target, so collapse the whole plan to `none` here — this is the
  // single point that stops a default/stored `local` target from resolving a
  // device and letting `buildStepToolDelta` re-inject local-system. Hetero
  // agents always need a runtime, so they never take this path.
  if (resolveToolMode(chatConfig) === 'chat' && !isHetero) return { kind: 'none', target: 'none' };

  const target = resolveExecutionTarget(agencyConfig, {
    isHetero,
    clientExecutionAvailable,
    sandboxExecutionAvailable,
    trigger,
    workspaceScoped,
  });
  const sandboxAvailable =
    sandboxExecutionAvailable ?? agencyConfig?.heterogeneousProvider?.type !== 'amp';
  const wantsDevice =
    !!requestedDeviceId || target === 'device' || target === 'local' || target === 'auto';

  if (!wantsDevice || !canUseDevice) {
    if (target === 'sandbox') return { kind: 'sandbox', target: 'sandbox' };
    // Hetero agents that support cloud execution fall back to the sandbox when
    // no device can run. Device-only providers stay pending at `none` so the
    // caller can require an explicit local/connected-device selection.
    if (isHetero && sandboxAvailable) return { kind: 'sandbox', target: 'sandbox' };
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
