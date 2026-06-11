import { isDesktop as defaultIsDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { type DeviceExecutionTarget, type HeterogeneousProviderConfig } from '@lobechat/types';

import { resolveExecutionTarget } from '@/helpers/executionTarget';

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
  /**
   * Per-agent execution device choice from the composer's Execution Device
   * switcher. Only meaningful when `heterogeneousProvider` is a local CLI
   * (claude-code / codex). Controls the desktop fork:
   *   - `'device'` / `'sandbox'` → route through Gateway so the server can
   *     dispatch to an `lh connect` device or spawn a sandbox.
   *   - `'local'` / `undefined`  → keep today's default (desktop → `hetero`
   *     in-process spawn, web → `gateway` sandbox).
   */
  executionTarget?: DeviceExecutionTarget;
  /** Per-agent heterogeneous provider config (desktop only — takes priority over gateway). */
  heterogeneousProvider?: HeterogeneousProviderConfig;
  /** Result of `chatStore.isGatewayModeEnabled()`. */
  isGatewayMode: boolean;
  /**
   * Explicit override that wins over automatic selection.
   *
   * Used by sub-agent dispatches (`directMentionRoute`, `callAgent`) so child
   * operations inherit the parent operation's runtime instead of re-running
   * the global decision — a sub-agent spawned inside a Gateway run should
   * stay on Gateway, even if its own agent config would say otherwise.
   */
  parentRuntime?: AgentRuntimeType;
}

interface SelectRuntimeTypeOptions {
  /** Override of `isDesktop` for testability. Defaults to the build-time const. */
  isDesktop?: boolean;
}

/**
 * Centralized "which runtime should run this agent operation" decision.
 *
 * The same priority is applied at every entry point (sendMessage, regenerate,
 * resume, continue, sub-agent dispatch, …) so adding a new entry point does
 * not require re-deriving the routing rules.
 *
 * Priority: `parentRuntime` > `hetero` (desktop only) > `gateway` > `client`.
 */
export const selectRuntimeType = (
  ctx: RuntimeSelectionContext,
  { isDesktop = defaultIsDesktop }: SelectRuntimeTypeOptions = {},
): AgentRuntimeType => {
  if (ctx.parentRuntime) return ctx.parentRuntime;
  // Remote device agents (openclaw / hermes) always use the gateway path regardless of
  // desktop/web — they communicate via a device connected with `lh connect`, not via
  // local desktop IPC. No special desktop handling needed.
  if (ctx.heterogeneousProvider && isRemoteHeterogeneousType(ctx.heterogeneousProvider.type)) {
    return 'gateway';
  }
  // Local CLI hetero (claude-code / codex) — route by the resolved execution
  // target (shared resolution with the server / the device switcher UI):
  // `device` / `sandbox` need server-side dispatch; `local` runs in-process on
  // the desktop. Unset and `none` resolve to `local` on desktop (in-process)
  // and `sandbox` on web (gateway).
  if (ctx.heterogeneousProvider) {
    const target = resolveExecutionTarget(
      { executionTarget: ctx.executionTarget },
      { isDesktop, isHetero: true },
    );
    return target === 'local' ? 'hetero' : 'gateway';
  }
  if (ctx.isGatewayMode) return 'gateway';
  return 'client';
};
