import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';

import { HeterogeneousPersistenceHandler } from './HeterogeneousPersistenceHandler';

const log = debug('lobe-server:hetero-agent-service');

export type HeterogeneousAgentType = 'claude-code' | 'codex';

export type HeterogeneousFinishResult = 'success' | 'error' | 'cancelled';

export interface HeterogeneousIngestParams {
  agentType: HeterogeneousAgentType;
  events: AgentStreamEvent[];
  operationId: string;
  topicId: string;
}

export interface HeterogeneousFinishParams {
  agentType: HeterogeneousAgentType;
  error?: { message: string; type: string };
  operationId: string;
  result: HeterogeneousFinishResult;
  /**
   * Native CLI session id (e.g. CC's per-cwd session). Used in phase 2c to
   * persist on `topic.metadata` so a subsequent `lh hetero exec` run can
   * resume context.
   */
  sessionId?: string;
  topicId: string;
}

export interface HeterogeneousAgentServiceOptions {
  /** Inject a pre-built persistence handler (used by tests). */
  persistenceHandler?: HeterogeneousPersistenceHandler;
  /** Inject a pre-built manager (used by tests). */
  streamEventManager?: IStreamEventManager;
  /** Inject a pre-built TopicModel (used by tests for the resume helper). */
  topicModel?: TopicModel;
}

/**
 * Server-side ingest handler for heterogeneous agent CLIs (`lh hetero exec`
 * for Claude Code / Codex). Receives `AgentStreamEvent` batches from the
 * producer and republishes them through the existing `StreamEventManager`
 * fanout, so renderer-side gateway WS subscribers see the same wire shape
 * regardless of whether the run came from the agent gateway or a CLI process.
 *
 * Phase 2a scope: pure pub/sub. Phase 2b adds DB persistence via
 * `HeterogeneousPersistenceHandler`. Phase 2c persists `sessionId` to
 * `topic.metadata.heterogeneousSessions`.
 */
export class HeterogeneousAgentService {
  private readonly db: LobeChatDatabase;
  private readonly persistenceHandler: HeterogeneousPersistenceHandler;
  private readonly streamEventManager: IStreamEventManager;
  private readonly topicModel: TopicModel;
  private readonly userId: string;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    options: HeterogeneousAgentServiceOptions = {},
  ) {
    this.db = db;
    this.userId = userId;
    this.streamEventManager = options.streamEventManager ?? createStreamEventManager();
    this.topicModel = options.topicModel ?? new TopicModel(db, userId);
    this.persistenceHandler =
      options.persistenceHandler ??
      new HeterogeneousPersistenceHandler({
        messageModel: new MessageModel(db, userId),
        threadModel: new ThreadModel(db, userId),
        topicModel: this.topicModel,
      });
  }

  async heteroIngest(params: HeterogeneousIngestParams): Promise<void> {
    const { agentType, events, operationId, topicId } = params;

    log(
      'heteroIngest: user=%s topic=%s op=%s type=%s count=%d',
      this.userId,
      topicId,
      operationId,
      agentType,
      events.length,
    );

    // Persist FIRST, then publish — the renderer's gateway handler triggers
    // `fetchAndReplaceMessages` on stream_start / tool_end / step_complete,
    // so DB must already reflect the latest writes when the WS event lands.
    // Persistence failures throw so the CLI BatchIngester retries the batch;
    // events that already landed are skipped via the handler's idempotency
    // map keyed on (stepIndex, type, timestamp).
    await this.persistenceHandler.ingest({ events, operationId, topicId });

    // Sequential publish preserves stepIndex ordering — Redis XADD itself is
    // serialized but awaiting in-order avoids interleaving with concurrent
    // ingest batches sharing the same operationId.
    for (const event of events) {
      // Each event already carries operationId; pass through unchanged so the
      // wire shape on the WS side is identical to gateway-driven runs.
      await this.streamEventManager.publishStreamEvent(operationId, {
        data: event.data,
        stepIndex: event.stepIndex,
        type: event.type,
      });
    }
  }

  async heteroFinish(params: HeterogeneousFinishParams): Promise<void> {
    const { agentType, error, operationId, result, sessionId, topicId } = params;

    log(
      'heteroFinish: user=%s topic=%s op=%s type=%s result=%s sessionId=%s',
      this.userId,
      topicId,
      operationId,
      agentType,
      result,
      sessionId ?? '<none>',
    );

    // Drain any pending state in the persistence handler — flushes trailing
    // accumulated content / reasoning that the in-stream `agent_runtime_end`
    // already wrote (no-op when state is clean), persists the CLI's native
    // session id for next-turn resume, and frees the per-operation memory.
    await this.persistenceHandler.finish({ error, operationId, result, sessionId });

    // Always emit a terminal `agent_runtime_end` so renderer subscribers shut
    // down even if the CLI stream missed it (process killed mid-flight,
    // network drop on last batch). Idempotent on the renderer side: the
    // gateway event handler latches `terminalState` on first end-event.
    await this.streamEventManager.publishStreamEvent(operationId, {
      data: {
        agentType,
        error,
        operationId,
        reason: result,
        sessionId,
      },
      stepIndex: 0,
      type: 'agent_runtime_end',
    });
  }

  /**
   * Look up the persisted CLI session id for a topic so the orchestrator
   * (phase 3 cloud sandbox) can pass `--resume <sessionId>` to the next
   * `lh hetero exec` spawn. Returns undefined when no prior run completed
   * on this topic — caller should spawn fresh.
   *
   * Reads the same `topic.metadata.heteroSessionId` the desktop renderer
   * writes, so resume state is shared between desktop and cloud paths.
   */
  async getHeterogeneousResumeSessionId(topicId: string): Promise<string | undefined> {
    const topic = await this.topicModel.findById(topicId);
    return topic?.metadata?.heteroSessionId;
  }
}

export { HeterogeneousPersistenceHandler } from './HeterogeneousPersistenceHandler';
