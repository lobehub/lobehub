import {
  DEFAULT_BOT_WAKE_ENGINE,
  DEFAULT_BOT_WAKE_MODEL,
  DEFAULT_BOT_WAKE_PROVIDER,
} from '@lobechat/business-const';
import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { GenerateObjectPayload, ModelRuntime } from '@lobechat/model-runtime';
import {
  BOT_WAKE_CLASSIFIER_JSON_SCHEMA,
  BOT_WAKE_CLASSIFIER_PROMPT_VERSION,
  BOT_WAKE_DECISION_PROMPT_VERSION,
  BOT_WAKE_MESSAGE_KINDS,
  type BotWakeClassifierInput,
  chainBotWakeClassifier,
  chainBotWakeDecision,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { describeLine } from '@/server/services/agentSignal/scenarios/botWake/conversation';
import type {
  WakeClassification,
  WakeClassifierInput,
  WakeClassify,
} from '@/server/services/agentSignal/scenarios/botWake/policies/classifier';

const log = debug('lobe-server:bot:wake-classifier');

const ClassificationSchema = z.object({
  addressedToBot: z.number().min(0).max(1),
  kind: z.enum(BOT_WAKE_MESSAGE_KINDS),
  reason: z.string(),
});

/** A decision answer is a probability; anything outside 0..1 is a malformed answer, not a score. */
export const ProbabilitySchema = z.number().min(0).max(1);

/**
 * How long a prepared model runtime is reused. Preparing one reads the provider's settings and
 * keys from the database, which is time the classifier's 2s deadline cannot spare on every
 * message of a busy channel; five minutes keeps a rotated key from lingering.
 */
const RUNTIME_TTL_MS = 5 * 60 * 1000;

export interface CreateWakeClassifyOptions {
  agentId?: string;
  db: LobeChatDatabase;
  /**
   * `decision` asks a decision model typed questions (fast, a probability per answer); `chat`
   * asks a chat model for JSON through `generateObject`. Defaults to the deployment's choice.
   */
  engine?: 'chat' | 'decision';
  /** Model override; defaults to the deployment's bot-wake model. */
  model?: string;
  provider?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * A model runtime prepared once and reused for {@link RUNTIME_TTL_MS}. A failed preparation is not
 * remembered: the next call prepares it again.
 */
export const createRuntimeCache = ({
  db,
  provider,
  userId,
  workspaceId,
}: Pick<CreateWakeClassifyOptions, 'db' | 'provider' | 'userId' | 'workspaceId'> & {
  provider: string;
}) => {
  let prepared: { expiresAt: number; runtime: Promise<ModelRuntime> } | undefined;

  return (): Promise<ModelRuntime> => {
    if (!prepared || prepared.expiresAt <= Date.now()) {
      const runtime = initModelRuntimeFromDB(db, userId, provider, workspaceId);
      const entry = { expiresAt: Date.now() + RUNTIME_TTL_MS, runtime };
      prepared = entry;
      // A failure must not stick: the next message prepares it again.
      runtime.catch(() => {
        if (prepared === entry) prepared = undefined;
      });
    }

    return prepared.runtime;
  };
};

/** Whose message the judged one replies to, as the prompt names it. */
const describeReplyTo = ({
  conversation,
  signal,
}: Pick<WakeClassifierInput, 'conversation' | 'signal'>): BotWakeClassifierInput['replyTo'] => {
  const { replyToAuthorId: id, replyToAuthorName: name } = signal;
  if (!id) return;
  if (id === signal.applicationId) return { name, who: 'assistant' };
  if (id === signal.author?.id) return { name, who: 'author' };
  if (conversation?.ownerId && id === conversation.ownerId) return { name, who: 'owner' };

  return { name, who: 'other' };
};

/** The classifier input as the prompt chains take it. */
export const toPromptInput = ({
  conversation,
  customInstructions,
  signal,
}: WakeClassifierInput): BotWakeClassifierInput => ({
  agent: conversation?.agent,
  botNames: conversation?.botNames,
  customInstructions,
  lastBotMessage: conversation?.lastBotMessage,
  message: signal.message,
  messageFromOwner: signal.author?.isOwner === true,
  ownerNames: conversation?.ownerNames,
  recentMessages: conversation?.recent.map((line) =>
    describeLine(line, signal.applicationId, conversation.ownerId),
  ),
  replyTo: describeReplyTo({ conversation, signal }),
});

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
 * - A `WakeClassify`. With a decision model (the default) it goes through `ModelRuntime.decide`
 *   and the score is the probability the model gives to "addressed to the bot"; with a chat model
 *   it goes through `generateObject` under the `bot_wake_classifier` tracing scenario. Rejects on
 *   a malformed or refused answer; the policy turns a rejection into a pass.
 *
 * The prepared runtime is reused for a few minutes, and a failed preparation is not remembered.
 */
export const createWakeClassify = ({
  agentId,
  db,
  engine = DEFAULT_BOT_WAKE_ENGINE,
  model = DEFAULT_BOT_WAKE_MODEL,
  provider = DEFAULT_BOT_WAKE_PROVIDER,
  userId,
  workspaceId,
}: CreateWakeClassifyOptions): WakeClassify => {
  const getRuntime = createRuntimeCache({ db, provider, userId, workspaceId });

  const classifyWithDecision = async (
    input: BotWakeClassifierInput,
    abortSignal: AbortSignal,
  ): Promise<WakeClassification> => {
    const runtime = await getRuntime();
    const { questions, state } = chainBotWakeDecision(input);

    const response = await runtime.decide(
      { model, questions, state },
      {
        metadata: { trigger: RequestTrigger.Bot },
        signal: abortSignal,
        tracing: {
          agentId,
          promptVersion: BOT_WAKE_DECISION_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.BotWakeClassifier,
          schemaName: 'bot_wake_decision',
        } satisfies TracingOptions,
      },
    );

    const { addressed, kind } = response.answers;
    // Without a score there is nothing to threshold; refusing is not "not addressed".
    if (addressed.type !== 'boolean') {
      throw new Error(
        `decision model refused: ${(addressed as { reason?: string }).reason ?? 'no reason'}`,
      );
    }
    const probability = ProbabilitySchema.parse(addressed.probability);

    return {
      addressedToBot: probability,
      // The kind is a label for the data flywheel; losing it must not lose the score.
      kind: kind.type === 'choice' ? kind.choice : 'other',
      reason: `${model} p=${probability.toFixed(2)}`,
    };
  };

  const classifyWithChat = async (
    input: BotWakeClassifierInput,
    abortSignal: AbortSignal,
  ): Promise<WakeClassification> => {
    const chain = chainBotWakeClassifier(input);
    const runtime = await getRuntime();

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

  return async (classifierInput, abortSignal) => {
    const input = toPromptInput(classifierInput);

    log(
      'classify engine=%s model=%s provider=%s thread=%s',
      engine,
      model,
      provider,
      classifierInput.signal.platformThreadId,
    );

    return engine === 'decision'
      ? classifyWithDecision(input, abortSignal)
      : classifyWithChat(input, abortSignal);
  };
};
