import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { FollowUpChip, FollowUpExtractInput, FollowUpExtractResult } from '@lobechat/types';
import debug from 'debug';

import { type LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { buildSuggestionPrompt } from './prompts';
import { RawResponseSchema, SUGGESTION_RESPONSE_JSON_SCHEMA } from './schema';

const log = debug('lobe-server:follow-up-action-service');

const EMPTY_RESULT = (messageId: string): FollowUpExtractResult => ({ chips: [], messageId });

export class FollowUpActionService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async extract({ topicId, hint }: FollowUpExtractInput): Promise<FollowUpExtractResult> {
    // Resolve the latest assistant message that actually has user-facing text.
    // Tool-call-only messages have empty content and must be skipped.
    const row = await this.db.query.messages.findFirst({
      columns: { content: true, id: true },
      orderBy: (m, { desc }) => desc(m.createdAt),
      where: (m, { and, eq, isNotNull, ne }) =>
        and(
          eq(m.userId, this.userId),
          eq(m.topicId, topicId),
          eq(m.role, 'assistant'),
          isNotNull(m.content),
          ne(m.content, ''),
        ),
    });

    if (!row) return EMPTY_RESULT('');

    const text = (row.content ?? '').trim();
    if (!text) return EMPTY_RESULT(row.id);

    const { system, user } = buildSuggestionPrompt({ assistantText: text, hint });
    const { model, provider } = this.getModelConfig();

    let raw: unknown;
    try {
      const modelRuntime = await initModelRuntimeFromDB(this.db, this.userId, provider);
      raw = await modelRuntime.generateObject({
        messages: [
          { content: system, role: 'system' as const },
          { content: user, role: 'user' as const },
        ],
        model,
        schema: SUGGESTION_RESPONSE_JSON_SCHEMA,
      });
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

  private getModelConfig(): { model: string; provider: string } {
    const overrideModel = process.env.FOLLOW_UP_ACTION_MODEL;
    const overrideProvider = process.env.FOLLOW_UP_ACTION_PROVIDER;
    if (overrideModel && overrideProvider) {
      return { model: overrideModel, provider: overrideProvider };
    }
    const fallback = DEFAULT_SYSTEM_AGENT_CONFIG.topic;
    return {
      model: overrideModel ?? fallback.model,
      provider: overrideProvider ?? fallback.provider,
    };
  }
}
