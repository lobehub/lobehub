import { randomUUID } from 'node:crypto';

import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainGenerateSkillMeta,
  chainSummaryTitle,
  GENERATE_SKILL_META_PROMPT_VERSION,
  GENERATE_SKILL_META_SCHEMA,
  GENERATE_SKILL_META_SCHEMA_NAME,
} from '@lobechat/prompts';
import type { UserSystemAgentConfig, UserSystemAgentConfigKey } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { resolveSystemAgentModelConfig } from './modelConfig';

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
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
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

      const modelRuntime = await initModelRuntimeFromDB(
        this.db,
        this.userId,
        provider,
        this.workspaceId,
      );
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

  /**
   * Generate skill metadata (name / title / description) from a document body,
   * used to prefill the "convert document to skill" form.
   *
   * Emits an `llm_generation_tracing` row under a pre-allocated `tracingId` and
   * returns it so the client can later record implicit feedback (whether the
   * user edited the generated values before saving).
   *
   * @returns The generated metadata + tracingId, or null on failure
   */
  async generateSkillMeta(params: {
    agentId?: string;
    content: string;
  }): Promise<{ description: string; name: string; title: string; tracingId: string } | null> {
    const { agentId, content } = params;
    if (!content.trim()) return null;

    try {
      const { model, provider } = await this.getTaskModelConfig('agentMeta');
      const locale = await this.getUserLocale();

      log('generateSkillMeta: locale=%s, model=%s, provider=%s', locale, model, provider);

      const payload = chainGenerateSkillMeta({ content, responseLanguage: locale });
      const tracingId = randomUUID();

      const modelRuntime = await initModelRuntimeFromDB(
        this.db,
        this.userId,
        provider,
        this.workspaceId,
      );
      const result = await modelRuntime.generateObject(
        {
          messages: payload.messages as any[],
          model,
          schema: GENERATE_SKILL_META_SCHEMA,
        },
        {
          metadata: { trigger: RequestTrigger.Api },
          tracing: {
            agentId,
            promptVersion: GENERATE_SKILL_META_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.SkillMeta,
            schemaName: GENERATE_SKILL_META_SCHEMA_NAME,
            tracingId,
          } satisfies TracingOptions,
        },
      );

      const meta = result as { description?: string; name?: string; title?: string };
      const name = meta?.name?.trim();
      const title = meta?.title?.trim();
      const description = meta?.description?.trim();

      if (!name || !title || !description) {
        log('generateSkillMeta: LLM returned incomplete meta');
        return null;
      }

      log('generateSkillMeta: generated name="%s", title="%s"', name, title);
      return { description, name, title, tracingId };
    } catch (error) {
      console.error('SystemAgentService.generateSkillMeta failed:', error);
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
    return resolveSystemAgentModelConfig({ taskConfig, taskKey });
  }

  /**
   * Get the user's preferred response language (locale).
   */
  async getUserLocale(): Promise<string> {
    const userInfo = await UserModel.getInfoForAIGeneration(this.db, this.userId);
    return userInfo.responseLanguage || 'en-US';
  }
}
