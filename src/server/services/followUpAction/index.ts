import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { FollowUpChip, FollowUpExtractInput, FollowUpExtractResult } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { buildSuggestionPrompt } from './prompts';
import { RawResponseSchema, SUGGESTION_RESPONSE_JSON_SCHEMA } from './schema';

const log = debug('lobe-server:follow-up-action-service');

const EMPTY_RESULT = (messageId: string): FollowUpExtractResult => ({ messageId, chips: [] });

export class FollowUpActionService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly messageModel: MessageModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.messageModel = new MessageModel(db, userId);
  }

  async extract({ messageId, hint }: FollowUpExtractInput): Promise<FollowUpExtractResult> {
    const message = await this.messageModel.findById(messageId);
    if (!message || message.role !== 'assistant') return EMPTY_RESULT(messageId);

    const text = (message.content ?? '').trim();
    if (!text) return EMPTY_RESULT(messageId);

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
      return EMPTY_RESULT(messageId);
    }

    const parsed = RawResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log('LLM response did not match schema: %O', parsed.error.flatten());
      return EMPTY_RESULT(messageId);
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

    return { messageId, chips };
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
