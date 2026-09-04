import { randomUUID } from 'node:crypto';

import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainFollowUpAction,
  FOLLOW_UP_JSON_SCHEMA,
  FOLLOW_UP_PROMPT_VERSION,
} from '@lobechat/prompts';
import type { FollowUpChip, FollowUpExtractInput, FollowUpExtractResult } from '@lobechat/types';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { notShareVisitorMessage } from '@/database/utils/shareVisitor';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { getLLMGenerationTracingService } from '@/server/services/llmGenerationTracing';

import { RawResponseSchema } from './schema';

const log = debug('lobe-server:follow-up-action-service');

const EMPTY_RESULT = (messageId: string): FollowUpExtractResult => ({ chips: [], messageId });

export class FollowUpActionService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  async extract({
    topicId,
    threadId,
    hint,
    modelConfig,
  }: FollowUpExtractInput): Promise<FollowUpExtractResult> {
    // Resolve the latest assistant message that actually has user-facing text.
    // Tool-call-only messages have empty content and must be skipped.
    const row = await this.db.query.messages.findFirst({
      columns: { content: true, id: true },
      orderBy: (m, { desc }) => desc(m.createdAt),
      where: (m, { and, eq, isNotNull, isNull, ne }) =>
        and(
          this.workspaceId
            ? eq(m.workspaceId, this.workspaceId)
            : and(eq(m.userId, this.userId), isNull(m.workspaceId)),
          eq(m.topicId, topicId),
          // Discriminate thread vs main topic: an absent threadId must NOT
          // surface a thread reply that lives under the same topicId.
          threadId ? eq(m.threadId, threadId) : isNull(m.threadId),
          eq(m.role, 'assistant'),
          isNotNull(m.content),
          ne(m.content, ''),
          // `topicId` is client input and agent-share visitor topics carry the
          // creator's userId, so without this a creator could feed a visitor
          // topic id here and get the visitor's assistant reply summarized
          // into chips — the same read the creator-facing routers deny.
          notShareVisitorMessage(),
        ),
    });

    if (!row) return EMPTY_RESULT('');

    const text = (row.content ?? '').trim();
    if (!text) return EMPTY_RESULT(row.id);

    const chain = chainFollowUpAction({ assistantText: text, hint });
    const { model, provider } = modelConfig;

    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    // Pre-allocate the tracing row id so it can be returned to the client
    // synchronously — the client holds it for the chip's lifetime to report a
    // click (positive) / dismissal (negative) back via `recordFeedback`.
    //
    // Gate on the tracing store actually being configured: when it isn't (e.g.
    // prod without ENABLE_LLM_GENERATION_TRACING_S3), the tracing hook is a
    // no-op and never inserts a row, so handing the client an id would make
    // every feedback call resolve to NOT_FOUND.
    const tracingId = getLLMGenerationTracingService().isEnabled() ? randomUUID() : undefined;
    let raw: unknown;
    try {
      raw = await ai.generateObject(
        {
          ...chain,
          model,
          provider,
          schema: FOLLOW_UP_JSON_SCHEMA,
        },
        {
          tracing: {
            promptVersion: FOLLOW_UP_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.FollowUp,
            schemaName: FOLLOW_UP_JSON_SCHEMA.name,
            topicId,
            tracingId,
          } satisfies TracingOptions,
        },
      );
    } catch (error) {
      log('LLM call failed: %O', error);
      return EMPTY_RESULT(row.id);
    }

    const parsed = RawResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log('LLM response did not match schema: %O', parsed.error.flatten());
      return EMPTY_RESULT(row.id);
    }

    const chips: FollowUpChip[] = parsed.data.chips
      .filter(
        (c) =>
          c.label.length >= 1 &&
          c.label.length <= 40 &&
          c.message.length >= 1 &&
          c.message.length <= 200,
      )
      .slice(0, 4);

    // Only surface the tracingId when chips actually rendered (nothing to act
    // on otherwise) AND tracing is enabled (a row exists to attach feedback to).
    return chips.length > 0 && tracingId
      ? { chips, messageId: row.id, tracingId }
      : { chips, messageId: row.id };
  }
}
