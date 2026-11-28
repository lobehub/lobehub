import type { StreamStartParentMessage } from '@lobechat/agent-gateway-client';
import type { MainAgentRunState } from '@lobechat/heterogeneous-agents';

import type { MessageModel } from '@/database/models/message';
import type { ThreadModel } from '@/database/models/thread';
import type { TopicModel } from '@/database/models/topic';

/**
 * Per-operation in-memory state. Lifetime spans the whole CLI run from first
 * `heteroIngest` batch through `heteroFinish`. Main-agent state is projected
 * back from DB at each ingest boundary; active subagent run state is still the
 * in-memory part of the operation. The topic tool index is rebuilt in full
 * only when another writer may have run (see `toolIndexSync`).
 */
export interface OperationState {
  agentId: string | null;
  /** Native turn boundary shared by the user prompt and every assistant/tool step. */
  codexTurnId?: string;
  /**
   * CC-native session id this run is producing, captured off the stream_start
   * event stream and stamped on every persisted message's
   * `metadata.heteroSessionId`. Run-global and stable; a change ACROSS a topic
   * (visible only because it's copied per-message) means CC forked a new
   * session — the forensic signal for a lost-`--resume` "session break".
   * Recovered on a cold replica from the current assistant's stamped metadata.
   */
  heteroSessionId: string | undefined;
  /** Last DB-confirmed tool-state seq, scoped to this operation. */
  lastAppliedToolStateSeqByCallId: Map<string, number>;
  lastStepIndex: number;
  main: MainAgentRunState;
  /** `(operationId, toolCallId, transition)` notification dedupe ledger. */
  notifiedInterventionTransitions: Set<string>;
  operationId: string;
  processedKeys: Set<string>;
  /**
   * Publish gate, peer of `processedKeys` but for the live-stream sink.
   * Persistence and publish fail independently: a batch can persist fully
   * yet die inside the publish loop — its retry must republish ONLY the
   * unpublished tail — while a batch whose tRPC response was lost after
   * full success must republish nothing. Keyed by `eventKey`, latched only
   * after the event's XADD succeeds.
   */
  publishedKeys: Set<string>;
  /** User message answered by this operation, checked against its topic/thread before stamping. */
  sourceUserMessageId?: string;
  /** Steer user messages written in this run, by id (see `streamStartParentMessages`). */
  steerMessages: Map<string, StreamStartParentMessage>;
  /**
   * Assistant row each main-agent `stream_start` resolved to, keyed by
   * `eventKey`. Read when the event is published (stamped as
   * `assistantMessage.id`) and dropped once its XADD succeeds.
   */
  streamStartAssistantIds: Map<string, string>;
  /**
   * Steer user message a main-agent `stream_start` opened its reply under,
   * keyed by `eventKey`, stamped as `parentMessage` when the event is
   * published so the client shows the message without a refetch.
   */
  streamStartParentMessages: Map<string, StreamStartParentMessage>;
  /** Isolation thread that owns this heterogeneous run, when applicable. */
  threadId: string | undefined;
  /**
   * When `toolMsgIdByCallId` and the intervention / tool-state projections
   * were last known to match the DB. Undefined forces a full rebuild.
   *
   * - `at`: local clock just before that index read; the next incremental
   *   read starts a safety window before it.
   * - `stamp`: the `heteroIngestStamp` on the current assistant at that
   *   point, refreshed by each of this replica's own batch flushes. A
   *   different stamp means another replica ingested in between.
   */
  toolIndexSync?: { at: number; stamp: string | undefined };
  /**
   * Run-global DB index for every tool message in the topic, keyed by
   * `tool_call_id`. Main and subagent reducers keep only their per-turn maps;
   * this map lets a `tool_result` land even when its `tools_calling` was
   * reduced by another serverless replica.
   */
  toolMsgIdByCallId: Map<string, string>;
  /**
   * This operation's `heteroCurrentMsgId` as last read off the topic. A value
   * that differs from `main.currentAssistantId` means another writer moved
   * the turn pointer, so the tool index is rebuilt in full.
   */
  topicCurrentMsgId?: string;
  topicId: string;
}

export interface HeterogeneousPersistenceHandlerDeps {
  /**
   * Liveness probe against the operation row, used only when the topic has lost
   * its `runningOperation` marker: it answers whether this operation is still
   * `running` and still owns this topic, i.e. whether the producer behind the
   * batch is alive. Optional so standalone/test callers keep the marker-only
   * behaviour.
   */
  isOperationLiveOnTopic?: (operationId: string, topicId: string) => Promise<boolean>;
  messageModel: MessageModel;
  threadModel: ThreadModel;
  topicModel: TopicModel;
  userId?: string;
  workspaceId?: string;
}
