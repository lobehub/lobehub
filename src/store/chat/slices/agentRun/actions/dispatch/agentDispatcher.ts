import { isDesktop as defaultIsDesktop } from '@lobechat/const';
import {
  HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR,
  HETEROGENEOUS_PROVIDER_BINDING_PERSONAL_ONLY_ERROR,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { type DeviceExecutionTarget, type HeterogeneousProviderConfig } from '@lobechat/types';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { getElectronStoreState } from '@/store/electron';

/**
 * Which agent runtime should handle an operation.
 *
 * - `client`: in-browser AgentRuntime (default)
 * - `gateway`: cloud sandbox via Gateway WebSocket
 * - `hetero`: heterogeneous CLI agent (Claude Code, Codex, …) via desktop IPC or sandbox
 */
export type AgentRuntimeType = 'client' | 'gateway' | 'hetero';

/**
 * Unified intent for a non-hetero, non-group sub-agent invocation.
 *
 * All three caller patterns (`callSubAgent` / `callAgent` / `@agent`) map
 * their parameters into this shape before handing off to
 * `dispatchNonHeteroSubAgent`. Runtime routing is entirely the dispatcher's
 * responsibility — callers only declare *what* they want, not *how* to run it.
 *
 * Excluded from this contract:
 * - Hetero agents (handled by the heterogeneous pipeline)
 * - Group orchestration (handled by `groupOrchestration.triggerSpeak`)
 * - Async task mode (handled by the `execSubAgent` executor via state.type)
 */
export interface AgentInvocationIntent {
  /**
   * Instruction delivered to the sub-agent.
   * In client mode it is injected as a virtual user message prepended to the
   * existing message history. In gateway mode it becomes the `message` param
   * of `executeGatewayAgent` (i.e. a real user message on the server).
   */
  instruction: string;
  /**
   * Which invocation pattern produced this intent.
   * Preserved for logging / debugging; has no effect on runtime selection.
   */
  kind: 'callAgent' | 'callSubAgent' | 'mention';
  /**
   * ID of the tool result message that triggered this invocation.
   * Used as `parentMessageId` by the client executor.
   */
  parentMessageId: string;
  /** Target agent to execute. */
  targetAgentId: string;
}

export interface RuntimeSelectionContext {
  /** Device bound by the execution switcher. Used when desktop `local` syncs to web. */
  boundDeviceId?: string;
  /**
   * Per-agent execution device choice from the composer's Execution Device
   * switcher. Only meaningful when `heterogeneousProvider` is a local CLI
   * (claude-code / codex). Controls the desktop fork:
   *   - `'device'` / `'sandbox'` → route through Gateway so the server can
   *     dispatch to an `lh connect` device or spawn a sandbox.
   *   - `'local'` / `undefined`  → desktop → `gateway` dispatched back to this
   *     desktop's device when it is online (in-process `hetero` spawn
   *     otherwise), web → `gateway` sandbox unless a desktop-local
   *     boundDeviceId is available, in which case the server dispatches to it.
   */
  executionTarget?: DeviceExecutionTarget;
  /** Per-agent heterogeneous provider config (desktop only — takes priority over gateway). */
  heterogeneousProvider?: HeterogeneousProviderConfig;
  /** Result of `chatStore.isGatewayModeEnabled()`. */
  isGatewayMode: boolean;
  /**
   * The agent is workspace-scoped (`agent.workspaceId` set), regardless of
   * authorship or per-member overrides. Unlike `workspaceScoped`, this stays
   * true for the agent's author and for members with an explicit local
   * override — the cases that CAN spawn a workspace agent in-process.
   */
  isWorkspaceAgent?: boolean;
  /**
   * Explicit override that wins over automatic selection.
   *
   * Used by sub-agent dispatches (`directMentionRoute`, `callAgent`) so child
   * operations inherit the parent operation's runtime instead of re-running
   * the global decision — a sub-agent spawned inside a Gateway run should
   * stay on Gateway, even if its own agent config would say otherwise.
   */
  parentRuntime?: AgentRuntimeType;
  /**
   * The shared-row safety coercion still applies: a member without an explicit
   * `executionTarget` override never executes the shared config on their own
   * client (see `resolveWorkspaceScoped` / `resolveExecutionTarget`). False
   * for the author or an explicitly overriding member even when
   * `isWorkspaceAgent` is true.
   */
  workspaceScoped?: boolean;
}

interface SelectRuntimeTypeOptions {
  /** Override of `isDesktop` for testability. Defaults to the build-time const. */
  isDesktop?: boolean;
  /**
   * Whether this desktop is reachable as a device through the device gateway
   * (connected, with a known deviceId). Defaults to the live Electron store.
   */
  localDeviceOnline?: boolean;
}

const isLocalDeviceOnline = () => {
  const { gatewayConnectionStatus, gatewayDeviceInfo } = getElectronStoreState();
  return gatewayConnectionStatus === 'connected' && !!gatewayDeviceInfo?.deviceId;
};

/**
 * Centralized "which runtime should run this agent operation" decision.
 *
 * The same priority is applied at every entry point (sendMessage, regenerate,
 * resume, continue, sub-agent dispatch, …) so adding a new entry point does
 * not require re-deriving the routing rules.
 *
 * Priority: `parentRuntime` > `hetero` (desktop only) > `gateway` > `client`.
 *
 * The agent's model provider is intentionally not an input. A provider only
 * this device can reach (local Ollama / LM Studio, a private base URL) still
 * runs on `gateway`: the server drives the loop and relays each LLM attempt
 * to the client that started the run (`agent_llm_relay`, see
 * `services/llmRelay`); tools, persistence and the loop stay on the server
 * rather than falling back to the client runtime.
 */
export const selectRuntimeType = (
  ctx: RuntimeSelectionContext,
  { isDesktop = defaultIsDesktop, localDeviceOnline }: SelectRuntimeTypeOptions = {},
): AgentRuntimeType => {
  if (ctx.heterogeneousProvider?.authMode === 'api') {
    // Personal-scope invariant: Desktop main resolves the binding's providerId
    // with NO workspace header (see `providerBindingPort`), while a workspace
    // agent's binding was configured against workspace-scoped providers. The
    // author (or an explicitly overriding member) CAN spawn a workspace agent
    // in-process — `workspaceScoped` alone does not block them — so a colliding
    // personal provider id (e.g. builtin `anthropic`) would silently supply
    // different credentials. Reject before any IPC.
    // The deployment-default API source uses deployment-owned credentials
    // rather than a user provider id, so this guard stays on user-provider
    // bindings only.
    if (
      ctx.heterogeneousProvider.apiConfig &&
      ctx.heterogeneousProvider.apiConfig?.source !== 'server-default' &&
      ctx.isWorkspaceAgent
    ) {
      throw new Error(HETEROGENEOUS_PROVIDER_BINDING_PERSONAL_ONLY_ERROR);
    }
    const target = resolveExecutionTarget(
      {
        boundDeviceId: ctx.boundDeviceId,
        executionTarget: ctx.executionTarget,
        heterogeneousProvider: ctx.heterogeneousProvider,
      },
      {
        isHetero: true,
        clientExecutionAvailable: isDesktop,
        workspaceScoped: ctx.workspaceScoped,
      },
    );
    if (target !== 'local' || (ctx.parentRuntime && ctx.parentRuntime !== 'hetero')) {
      throw new Error(HETEROGENEOUS_PROVIDER_BINDING_LOCAL_ONLY_ERROR);
    }
  }

  if (ctx.parentRuntime) return ctx.parentRuntime;
  // Notify-based platform agents (openclaw / hermes) use the gateway transport for both
  // targets: `local` presets this desktop's personal device ID on the request, while
  // `device` dispatches to the configured remote device. They do not implement the
  // JSONL/session protocol consumed by the in-process `hetero` transport.
  if (ctx.heterogeneousProvider && isRemoteHeterogeneousType(ctx.heterogeneousProvider.type)) {
    return 'gateway';
  }
  // Local CLI hetero (Amp / Claude Code / Codex) — route by the resolved execution
  // target (shared resolution with the server / the device switcher UI):
  // `device` / `sandbox` need server-side dispatch. `local` also goes through
  // the gateway whenever this desktop is online as a device: the send carries
  // this desktop's deviceId (`resolveDesktopDeviceHints`), so the server
  // dispatches the run back here and other clients can follow it. The
  // in-process IPC spawn remains the fallback when gateway mode is off or the
  // device connection is down, and for API auth, whose provider credentials
  // only resolve inside this desktop's main process. On web, unbound `local`
  // resolves to sandbox when supported (otherwise the pending `none` state),
  // while a desktop `local` selection synced with boundDeviceId resolves to
  // device dispatch.
  if (ctx.heterogeneousProvider) {
    const target = resolveExecutionTarget(
      {
        boundDeviceId: ctx.boundDeviceId,
        executionTarget: ctx.executionTarget,
        heterogeneousProvider: ctx.heterogeneousProvider,
      },
      // on the client the desktop build IS where local execution is available
      {
        isHetero: true,
        clientExecutionAvailable: isDesktop,
        workspaceScoped: ctx.workspaceScoped,
      },
    );
    if (target !== 'local') return 'gateway';
    const routeLocalThroughGateway =
      ctx.isGatewayMode &&
      ctx.heterogeneousProvider.authMode !== 'api' &&
      (localDeviceOnline ?? isLocalDeviceOnline());
    return routeLocalThroughGateway ? 'gateway' : 'hetero';
  }
  if (ctx.isGatewayMode) return 'gateway';
  return 'client';
};
