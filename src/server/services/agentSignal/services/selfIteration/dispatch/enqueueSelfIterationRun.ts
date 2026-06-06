import type { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { type AgentSignalOperationMarker, RequestTrigger, ThreadType } from '@lobechat/types';

import { ThreadModel } from '@/database/models/thread';
import type { LobeChatDatabase } from '@/database/type';

/** The builtin self-iteration agent slugs an execAgent run can dispatch to. */
export type SelfIterationSlug =
  | typeof BUILTIN_AGENT_SLUGS.nightlyReview
  | typeof BUILTIN_AGENT_SLUGS.selfFeedbackIntent
  | typeof BUILTIN_AGENT_SLUGS.selfReflection
  | typeof BUILTIN_AGENT_SLUGS.skillManagement;

export interface EnqueueSelfIterationRunInput {
  /** The user agent being reviewed — owns the run, marker, and isolated thread. */
  agentId: string;
  db: LobeChatDatabase;
  /**
   * Run-scoped marker (kind / sourceId / review window / anchors). Stamped onto
   * the operation so the S2 completion path can project receipts/briefs from
   * finalState. `marker.sourceId` MUST be the originating source id (not the new
   * operation id) so receipt ids stay stable / idempotent across replays.
   */
  marker: AgentSignalOperationMarker;
  /** Step budget for the run; falls back to the builtin agent's own default. */
  maxSteps?: number;
  /** The evidence digest rendered as the user prompt (createAgentSignalSelfIterationPrompt). */
  prompt: string;
  slug: SelfIterationSlug;
  /** Assistant message to anchor the isolated thread under, when one exists. */
  sourceMessageId?: string;
  /** Isolated-thread title (defaults to a generic self-iteration label). */
  threadTitle?: string;
  /** Topic the run is scoped to; a new topic is created when absent. */
  topicId?: string;
  userId: string;
}

export interface EnqueueSelfIterationRunResult {
  operationId: string;
  threadId?: string;
  topicId: string;
}

/**
 * Dispatches a background self-iteration run (nightly-review / self-reflection /
 * self-feedback-intent) onto the unified async `execAgent` queue — the
 * replacement for the hand-rolled in-memory `AgentRuntime` + `executeSelfIteration`.
 *
 * - The builtin `slug` resolves the self-iteration tools server-side via the S1
 *   serverRuntime bridge (`agent-signal-{review,reflection,feedback-intent}`).
 * - `appContext.agentSignal` stamps the marker so the S2 completion handler
 *   projects receipts (and, for nightly-review, the brief is written in-run by
 *   the review tool primitive) from finalState.
 * - `suppressSignal: true` (and the slug being in `SELF_ITERATION_AGENT_SLUGS`)
 *   stop the synthesised user message from recursing into analyzeIntent.
 *
 * Fire-and-forget: returns as soon as the operation is enqueued (`autoStart`).
 * The run completes over later invocations; side effects land on completion.
 */
export const enqueueSelfIterationRun = async (
  input: EnqueueSelfIterationRunInput,
): Promise<EnqueueSelfIterationRunResult> => {
  // Isolate the run under the triggering assistant message (when present) so its
  // messages don't flatten into the main topic — mirrors the memory-writer path.
  let threadId: string | undefined;
  if (input.topicId && input.sourceMessageId) {
    try {
      const thread = await new ThreadModel(input.db, input.userId).create({
        agentId: input.agentId,
        sourceMessageId: input.sourceMessageId,
        title: input.threadTitle ?? 'Agent Signal Self-Iteration',
        topicId: input.topicId,
        type: ThreadType.Isolation,
      });
      threadId = thread?.id;
    } catch {
      // Non-fatal: fall back to writing into the main topic if thread creation fails.
    }
  }

  const { AiAgentService } = await import('@/server/services/aiAgent');
  const result = await new AiAgentService(input.db, input.userId).execAgent({
    appContext: {
      // No agentId here — the run executes under the builtin `slug` (which
      // supplies its tools / systemRole / model). The reviewed user agent
      // travels on `marker.agentId`; execAgent prefers it for the operation +
      // tool-execution context so resource writes (skills) and receipts both
      // attribute to the reviewed agent, not the builtin one.
      agentSignal: input.marker,
      scope: 'chat',
      ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
      suppressSignal: true,
      ...(threadId ? { threadId } : {}),
      ...(input.topicId ? { topicId: input.topicId } : {}),
    },
    autoStart: true,
    ...(input.maxSteps ? { maxSteps: input.maxSteps } : {}),
    prompt: input.prompt,
    slug: input.slug,
    trigger: RequestTrigger.AgentSignal,
    userInterventionConfig: { approvalMode: 'headless' },
  });

  return {
    operationId: result.operationId,
    ...(threadId ? { threadId } : {}),
    topicId: result.topicId,
  };
};
