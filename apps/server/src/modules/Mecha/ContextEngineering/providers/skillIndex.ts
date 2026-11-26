import type { AgentState } from '@lobechat/agent-runtime';
import {
  resolveSkillIndex,
  type ResolveSkillIndexInput,
  type SkillIndexSnapshot,
  type SkillMeta,
} from '@lobechat/context-engine';

import type { RuntimeExecutorContext } from '@/server/modules/AgentRuntime/context';
import { redisService } from '@/server/services/redis';

/** What the skill-index snapshot decision needs to know about the step. */
export interface SkillIndexTurn {
  /** Prompt-cache TTL of the provider the step calls. */
  cacheTtlMs: number;
  /** The conversation the context engine runs on. */
  messages: ResolveSkillIndexInput['messages'];
  /** The messages left after history truncation, when the agent limits history. */
  visibleMessages?: ResolveSkillIndexInput['messages'];
}

interface ResolveInput {
  agentId?: string;
  ctx: RuntimeExecutorContext;
  skills: SkillMeta[];
  state: AgentState;
  turn: SkillIndexTurn;
}

/**
 * Resolve the snapshot this step renders `<available_skills>` from.
 *
 * The run pins the snapshot in `binding.skillIndex`; the conversation keeps it
 * in Redis between runs so the next turn can continue it while the prompt cache
 * is warm. Without a topic/agent (or without Redis) every run takes a fresh
 * snapshot, which still keeps `<available_skills>` fixed within the run.
 */
export const resolveServerSkillIndex = async ({
  agentId,
  ctx,
  skills,
  state,
  turn,
}: ResolveInput): Promise<SkillIndexSnapshot> => {
  const pinned = state.binding?.skillIndex;
  const topicId = state.origin?.topicId ?? ctx.topicId;
  const scope =
    topicId && agentId ? { agentId, threadId: state.origin?.threadId, topicId } : undefined;

  // Only a run's first step may continue the stored snapshot; later steps never read it.
  const stored = !pinned && scope ? await redisService.skillIndex.get(scope) : undefined;
  const resolved = resolveSkillIndex({
    cacheTtlMs: turn.cacheTtlMs,
    messages: turn.messages,
    now: new Date(),
    pinned,
    skills,
    stored,
    visibleMessages: turn.visibleMessages,
  });

  if (resolved.pin) ctx.bindSkillIndex?.(resolved.snapshot);
  if (resolved.store && scope) {
    await redisService.skillIndex.set(scope, resolved.snapshot);
  }
  return resolved.snapshot;
};
