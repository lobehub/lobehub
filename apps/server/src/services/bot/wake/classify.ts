import { DEFAULT_MINI_SYSTEM_AGENT_ITEM, TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { GenerateObjectPayload } from '@lobechat/model-runtime';
import {
  BOT_WAKE_CLASSIFIER_JSON_SCHEMA,
  BOT_WAKE_CLASSIFIER_PROMPT_VERSION,
  BOT_WAKE_MESSAGE_KINDS,
  chainBotWakeClassifier,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import type {
  WakeClassification,
  WakeClassify,
} from '@/server/services/agentSignal/scenarios/botWake/policies/classifier';

const log = debug('lobe-server:bot:wake-classifier');

const ClassificationSchema = z.object({
  addressedToBot: z.number().min(0).max(1),
  kind: z.enum(BOT_WAKE_MESSAGE_KINDS),
  reason: z.string(),
});

export interface CreateWakeClassifyOptions {
  agentId?: string;
  db: LobeChatDatabase;
  /** Service-model override; defaults to the mini system agent. */
  model?: string;
  provider?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Builds the model call behind the classifier policy.
 *
 * Use when:
 * - A bot's wake policy set needs "is this message talking to the bot?" scored
 *
 * Expects:
 * - The caller applies the 2s deadline (the policy does) and passes the abort signal on, so a
 *   late answer stops costing tokens
 *
 * Returns:
 * - A `WakeClassify` that goes through `ModelRuntime.generateObject` with the
 *   `bot_wake_classifier` tracing scenario. Rejects on a malformed answer; the policy turns a
 *   rejection into a pass.
 */
export const createWakeClassify = ({
  agentId,
  db,
  model = DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
  provider = DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
  userId,
  workspaceId,
}: CreateWakeClassifyOptions): WakeClassify => {
  return async ({ customInstructions, signal }, abortSignal): Promise<WakeClassification> => {
    const chain = chainBotWakeClassifier({ customInstructions, message: signal.message });
    const runtime = await initModelRuntimeFromDB(db, userId, provider, workspaceId);

    log('classify model=%s provider=%s thread=%s', model, provider, signal.platformThreadId);

    const result = await runtime.generateObject(
      {
        messages: chain.messages as GenerateObjectPayload['messages'],
        model,
        schema: BOT_WAKE_CLASSIFIER_JSON_SCHEMA,
      },
      {
        metadata: { trigger: RequestTrigger.Bot },
        signal: abortSignal,
        tracing: {
          agentId,
          promptVersion: BOT_WAKE_CLASSIFIER_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.BotWakeClassifier,
          schemaName: BOT_WAKE_CLASSIFIER_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );

    return ClassificationSchema.parse(result);
  };
};
