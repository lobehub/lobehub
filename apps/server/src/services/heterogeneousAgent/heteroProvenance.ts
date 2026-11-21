import type { MessageModel } from '@/database/models/message';

/** Native provenance an operation has learned so far. */
export interface HeteroProvenanceState {
  /** Native turn boundary shared by the user prompt and every assistant/tool step. */
  codexTurnId?: string;
  heteroSessionId?: string;
}

export interface HeteroProvenance {
  codexTurnId?: string;
  heteroMessageId?: string;
  heteroSessionId?: string;
}

/**
 * Per-message provenance stamped on every hetero-persisted row: the CC
 * session id the turn ran under (`heteroSessionId`) and, when known, the CC
 * `message.id` of the turn (`heteroMessageId`). A per-message copy lets a
 * diff pinpoint the exact row where CC forked to a new session / lost
 * `--resume` history — something the topic-level single `heteroSessionId`
 * can never show. Returns `{}` when neither is known, so callers can spread
 * it without minting empty metadata.
 */
export const heteroProvenance = (
  state: HeteroProvenanceState,
  heteroMessageId?: string,
): HeteroProvenance => {
  const out: HeteroProvenance = {};
  if (state.codexTurnId) out.codexTurnId = state.codexTurnId;
  if (state.heteroSessionId) out.heteroSessionId = state.heteroSessionId;
  if (heteroMessageId) out.heteroMessageId = heteroMessageId;
  return out;
};

/**
 * Recovers provenance from a previously-stamped message so a cold replica that
 * never saw this run's stream_start still stamps the right ids on the messages
 * it persists. Ids already known to this replica win.
 */
export const restoreHeteroProvenance = (
  state: HeteroProvenanceState,
  metadata: Record<string, any>,
): void => {
  if (!state.codexTurnId && typeof metadata.codexTurnId === 'string') {
    state.codexTurnId = metadata.codexTurnId;
  }
  if (!state.heteroSessionId && typeof metadata.heteroSessionId === 'string') {
    state.heteroSessionId = metadata.heteroSessionId;
  }
};

export interface CodexTurnProvenanceState extends HeteroProvenanceState {
  main: { currentAssistantId: string };
  /** User message answered by this operation, checked against its topic/thread before stamping. */
  sourceUserMessageId?: string;
  threadId: string | undefined;
  topicId: string;
}

/**
 * Stamps a native Codex turn on the assistant and the user prompt it answers.
 *
 * Use when:
 * - A `stream_start` carrying `codexTurnId` reaches the server persistence path.
 * Expects:
 * - `state.codexTurnId` is already set to the event's turn.
 * Returns:
 * - After both writes; throws on a failed write so the ingest retry reapplies it.
 *
 * Call stack:
 *
 * HeterogeneousPersistenceHandler.reduceAndApply
 *   -> {@link persistCodexTurnProvenance}
 */
export const persistCodexTurnProvenance = async (
  messageModel: Pick<MessageModel, 'findById' | 'update'>,
  state: CodexTurnProvenanceState,
): Promise<void> => {
  const metadata = heteroProvenance(state);
  // Save provenance before any visible answer. An ingest retry must reapply a failed handoff.
  const assistantWrite = await messageModel.update(state.main.currentAssistantId, { metadata });
  if (!assistantWrite.success) throw new Error('Native assistant provenance could not be saved');
  if (!state.sourceUserMessageId) return;
  const user = await messageModel.findById(state.sourceUserMessageId);
  if (
    user?.role === 'user' &&
    user.topicId === state.topicId &&
    (user.threadId ?? undefined) === state.threadId
  ) {
    const userWrite = await messageModel.update(user.id, { metadata });
    if (!userWrite.success) throw new Error('Native user provenance could not be saved');
  }
};
