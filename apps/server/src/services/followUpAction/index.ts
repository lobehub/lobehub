import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { FollowUpChip, FollowUpExtractInput, FollowUpExtractResult } from '@lobechat/types';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { buildSuggestionPrompt, FOLLOW_UP_PROMPT_VERSION } from './prompts';
import { RawResponseSchema, SUGGESTION_RESPONSE_JSON_SCHEMA } from './schema';

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
        ),
    });

    if (!row) return EMPTY_RESULT('');

    const text = (row.content ?? '').trim();
    if (!text) return EMPTY_RESULT(row.id);

    const { system, user } = buildSuggestionPrompt({ assistantText: text, hint });
    const { model, provider } = modelConfig;

    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    let raw: unknown;
    try {
      raw = await ai.generateObject(
        {
          messages: [
            { content: system, role: 'system' as const },
            { content: user, role: 'user' as const },
          ],
          model,
          provider,
          schema: SUGGESTION_RESPONSE_JSON_SCHEMA,
        },
        {
          tracing: {
            promptVersion: FOLLOW_UP_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.FollowUp,
            schemaName: 'FollowUpSuggestionResponse',
            topicId,
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

    return { chips, messageId: row.id };
  }
}
