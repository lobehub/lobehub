import type { AgentState } from '@lobechat/agent-runtime';
import {
  type AgentContextDocument,
  type AgentDocumentIndexSnapshot,
  resolveAgentDocumentIndex,
  type ResolveAgentDocumentIndexInput,
} from '@lobechat/context-engine/agent-document';

import type { RuntimeExecutorContext } from '@/server/modules/AgentRuntime/context';
import { redisService } from '@/server/services/redis';

/** What the agent-document index decision needs to know about the step. */
export interface AgentDocumentIndexTurn {
  /** Prompt-cache TTL of the provider the step calls. */
  cacheTtlMs: number;
  /** The conversation the context engine runs on. */
  messages: ResolveAgentDocumentIndexInput['messages'];
  /** The messages left after history truncation, when the agent limits history. */
  visibleMessages?: ResolveAgentDocumentIndexInput['messages'];
}

interface ResolveInput {
  agentId: string;
  ctx: RuntimeExecutorContext;
  docs: AgentContextDocument[];
  state: AgentState;
  turn: AgentDocumentIndexTurn;
}

/**
 * Resolve the snapshot this step renders the agent-document index from.
 *
 * The run pins the snapshot in `binding.agentDocumentIndex`; the conversation
 * keeps it in Redis between runs so the next turn can continue it while the
 * prompt cache is warm. Without a topic (or without Redis) every run takes a
 * fresh snapshot, which still keeps the index fixed within the run.
 */
export const resolveServerAgentDocumentIndex = async ({
  agentId,
  ctx,
  docs,
  state,
  turn,
}: ResolveInput): Promise<AgentDocumentIndexSnapshot> => {
  const pinned = state.binding?.agentDocumentIndex;
  const topicId = state.origin?.topicId ?? ctx.topicId;
  const scope = topicId ? { agentId, threadId: state.origin?.threadId, topicId } : undefined;

  // Only a run's first step may continue the stored snapshot; later steps never read it.
  const stored = !pinned && scope ? await redisService.agentDocumentIndex.get(scope) : undefined;
  const resolved = resolveAgentDocumentIndex({
    cacheTtlMs: turn.cacheTtlMs,
    docs,
    messages: turn.messages,
    now: new Date(),
    pinned,
    stored,
    visibleMessages: turn.visibleMessages,
  });

  if (resolved.pin) ctx.bindAgentDocumentIndex?.(resolved.snapshot);
  if (resolved.store && scope) {
    await redisService.agentDocumentIndex.set(scope, resolved.snapshot);
  }
  return resolved.snapshot;
};
