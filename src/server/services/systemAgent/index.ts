import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import { chainSummaryTitle } from '@lobechat/prompts';
import type { UserSystemAgentConfig, UserSystemAgentConfigKey } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import { type LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const log = debug('lobe-server:system-agent-service');

const TOPIC_TITLE_SCHEMA = {
  name: 'topic_title',
  schema: {
    additionalProperties: false,
    properties: {
      title: { description: 'A concise topic title', type: 'string' },
    },
    required: ['title'],
    type: 'object' as const,
  },
  strict: true,
};

/**
 * Server-side service for SystemAgent automated tasks.
 *
 * Encapsulates the common pattern: read user's systemAgent config → build chain prompt
 * → call LLM via generateObject → return structured result.
 *
 * Each public method corresponds to a `UserSystemAgentConfigKey` task type
 * (topic, translation, agentMeta, etc.).
 */
export class SystemAgentService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Generate a concise topic title from user prompt + assistant reply.
   *
   * @returns The generated title string, or null on failure
   */
  async generateTopicTitle(params: {
    lastAssistantContent: string;
    userPrompt: string;
  }): Promise<string | null> {
    const { userPrompt, lastAssistantContent } = params;

    try {
      const { model, provider } = await this.getTaskModelConfig('topic');
      const locale = await this.getUserLocale();

      log('generateTopicTitle: locale=%s, model=%s, provider=%s', locale, model, provider);

      const messages = [
        { content: userPrompt, role: 'user' as const },
        { content: lastAssistantContent, role: 'assistant' as const },
      ];

      const payload = chainSummaryTitle(messages, locale);

      const modelRuntime = await initModelRuntimeFromDB(this.db, this.userId, provider);
      const result = await modelRuntime.generateObject(
        {
          messages: payload.messages as any[],
          model,
          schema: TOPIC_TITLE_SCHEMA,
        },
        { metadata: { trigger: RequestTrigger.Topic } },
      );

      const title = (result as { title?: string })?.title?.trim();
      if (!title) {
        log('generateTopicTitle: LLM returned empty title');
        return null;
      }

      log('generateTopicTitle: generated title="%s"', title);
      return title;
    } catch (error) {
      console.error('SystemAgentService.generateTopicTitle failed:', error);
      return null;
    }
  }

  // ============== Private Helpers ============== //

  /**
   * Get the model/provider config for a specific systemAgent task type.
   * Falls back to DEFAULT_SYSTEM_AGENT_CONFIG when user has no custom settings.
   */
  private async getTaskModelConfig(
    taskKey: UserSystemAgentConfigKey,
  ): Promise<{ model: string; provider: string }> {
    const userModel = new UserModel(this.db, this.userId);
    const settings = await userModel.getUserSettings();
    const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;

    const taskConfig = systemAgent?.[taskKey];
    const defaults = DEFAULT_SYSTEM_AGENT_CONFIG[taskKey];

    return {
      model: taskConfig?.model || defaults.model,
      provider: taskConfig?.provider || defaults.provider,
    };
  }

  /**
   * Get the user's preferred response language (locale).
   */
  private async getUserLocale(): Promise<string> {
    const userInfo = await UserModel.getInfoForAIGeneration(this.db, this.userId);
    return userInfo.responseLanguage || 'en-US';
  }
}
