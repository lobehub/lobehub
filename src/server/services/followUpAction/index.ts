import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { FollowUpChip, FollowUpExtractInput, FollowUpExtractResult } from '@lobechat/types';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
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
  private readonly agentModel: AgentModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.messageModel = new MessageModel(db, userId);
    this.agentModel = new AgentModel(db, userId);
  }

  async extract({
    messageId,
    agentId,
    hint,
  }: FollowUpExtractInput): Promise<FollowUpExtractResult> {
    const message = await this.messageModel.findById(messageId);
    if (!message || message.role !== 'assistant') return EMPTY_RESULT(messageId);

    const text = (message.content ?? '').trim();
    if (!text) return EMPTY_RESULT(messageId);

    const { system, user } = buildSuggestionPrompt({ assistantText: text, hint });

    const { model, provider } = await this.getModelConfig(agentId);

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

  /**
   * Resolve model + provider from the caller-supplied agent. Falls back to the
   * systemAgent topic config when the agent record has no explicit model/provider.
   */
  private async getModelConfig(agentId: string): Promise<{ model: string; provider: string }> {
    const fallback = DEFAULT_SYSTEM_AGENT_CONFIG.topic;
    const agent = await this.agentModel.getAgentConfigById(agentId);
    if (agent?.model && agent?.provider) {
      return { model: agent.model, provider: agent.provider };
    }
    return { model: fallback.model, provider: fallback.provider };
  }
}
