import type {
  ConversationContext,
  HeterogeneousProviderConfig,
  UIChatMessage,
} from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

import {
  type AgentInvocationIntent,
  type AgentRuntimeType,
  selectRuntimeType,
} from './agentDispatcher';

/**
 * Execution context supplied by the caller at dispatch time.
 * Carries the runtime-selection inputs and client-mode extras that the
 * dispatcher needs but that do not belong in the intent itself.
 */
export interface NonHeteroSubAgentDispatchContext {
  /** Conversation context of the *parent* agent (agentId = parent agent). */
  conversationContext: ConversationContext;
  /** Per-agent heterogeneous provider config used for runtime resolution. */
  heterogeneousProvider?: HeterogeneousProviderConfig;
  /**
   * Whether the sub-agent runs inside a portal thread.
   * Client mode only — has no effect in gateway mode.
   */
  inPortalThread?: boolean;
  /** Current gateway mode status (`chatStore.isGatewayModeEnabled()`). */
  isGatewayMode: boolean;
  /**
   * Messages passed to the client-side runner.
   * Typically the current conversation messages plus a virtual instruction
   * message prepended by the caller. Only consumed when runtime = 'client'.
   */
  messages?: UIChatMessage[];
  /**
   * Parent operation ID to link the sub-agent operation as a child.
   * Optional — only provided when the caller has an active operation to chain.
   */
  parentOperationId?: string;
  /**
   * Explicit runtime inherited from the parent operation.
   * When set, `selectRuntimeType` returns this value immediately, preserving
   * the parent's execution environment for the child invocation.
   */
  parentRuntime?: AgentRuntimeType;
}

/**
 * Unified dispatcher for non-hetero, non-group sub-agent invocations (LOBE-8927).
 *
 * Resolves the child runtime by inheriting from the parent (via
 * `selectRuntimeType` with `parentRuntime`), then routes to the correct
 * executor. Replaces the per-entry-point runtime selection and client-only
 * fallback that previously lived in `callAgent` and `#executeDirectMentionRoute`.
 *
 * Runtime routing rules (same as top-level `selectRuntimeType`):
 *   `parentRuntime` wins → otherwise hetero → gateway → client
 *
 * Context semantics by runtime:
 *   - client: `agentId` = parent agent (for message key), `subAgentId` = target
 *   - gateway: `agentId` = target agent (gateway runs this agent), `subAgentId` = target
 *
 * Explicitly excluded:
 *   - `hetero` runtime → throws (handled by the heterogeneous pipeline)
 *   - group orchestration → not routed here (callers guard this upstream)
 */
export async function dispatchNonHeteroSubAgent(
  intent: AgentInvocationIntent,
  ctx: NonHeteroSubAgentDispatchContext,
  store: Pick<ChatStore, 'executeClientAgent' | 'executeGatewayAgent'>,
): Promise<void> {
  const runtimeType = selectRuntimeType({
    heterogeneousProvider: ctx.heterogeneousProvider,
    isGatewayMode: ctx.isGatewayMode,
    parentRuntime: ctx.parentRuntime,
  });

  switch (runtimeType) {
    case 'client': {
      // Keep agentId as the parent agent so the message map key is correct.
      // subAgentId selects the target agent's config (effectiveAgentId = subAgentId).
      await store.executeClientAgent({
        context: {
          ...ctx.conversationContext,
          scope: 'sub_agent',
          subAgentId: intent.targetAgentId,
        },
        inPortalThread: ctx.inPortalThread,
        messages: ctx.messages ?? [],
        parentMessageId: intent.parentMessageId,
        parentMessageType: 'tool',
        parentOperationId: ctx.parentOperationId,
      });
      break;
    }

    case 'gateway': {
      // Switch agentId to the target agent so the gateway runs the correct one.
      // The gateway loads conversation history from the topic DB, so we do NOT
      // pass the client-side message array. The instruction becomes a real user
      // message created on the server.
      await store.executeGatewayAgent({
        context: {
          ...ctx.conversationContext,
          agentId: intent.targetAgentId,
          scope: 'sub_agent',
          subAgentId: intent.targetAgentId,
        },
        message: intent.instruction,
        parentOperationId: ctx.parentOperationId,
      });
      break;
    }

    case 'hetero': {
      // Hetero sub-agent invocation is out of scope for LOBE-8926.
      // Hetero agents are dispatched through a dedicated heterogeneous pipeline
      // (`executeHeterogeneousAgent`) and must not fall through to client mode.
      throw new Error(
        `[dispatchNonHeteroSubAgent] Hetero runtime is not supported for ` +
          `non-hetero sub-agent dispatch. ` +
          `kind=${intent.kind}, targetAgentId=${intent.targetAgentId}`,
      );
    }
  }
}
