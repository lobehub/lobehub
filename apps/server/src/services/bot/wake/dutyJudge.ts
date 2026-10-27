import {
  DEFAULT_BOT_WAKE_ENGINE,
  DEFAULT_BOT_WAKE_MODEL,
  DEFAULT_BOT_WAKE_PROVIDER,
} from '@lobechat/business-const';
import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { GenerateObjectPayload } from '@lobechat/model-runtime';
import {
  BOT_WAKE_DUTY_JSON_SCHEMA,
  BOT_WAKE_DUTY_PROMPT_VERSION,
  chainBotWakeDutyClassifier,
  chainBotWakeDutyDecision,
  MAX_MATCHED_DUTY_LENGTH,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type {
  WakeDutyJudge,
  WakeDutyJudgement,
} from '@/server/services/agentSignal/scenarios/botWake/policies/duty';

import type { CreateWakeClassifyOptions } from './classify';
import { createRuntimeCache, ProbabilitySchema, toPromptInput } from './classify';

const log = debug('lobe-server:bot:wake-duty');

const DutySchema = z.object({
  duty: z.string(),
  inDuty: z.number().min(0).max(1),
  reason: z.string(),
});

/** The matched duty as the agent is told it: one line, short. */
const shortDuty = (duty: string | undefined) =>
  duty?.replaceAll(/\s+/g, ' ').trim().slice(0, MAX_MATCHED_DUTY_LENGTH) || undefined;

/**
 * Builds the model call behind the duty policy: does a message nobody addressed to the bot fall
 * within the duties its owner gave it? Same engine, model and runtime choice as
 * `createWakeClassify`.
 *
 * Returns:
 * - A `WakeDutyJudge`. With a decision model the score is the probability of "within the duties",
 *   and the matched duty is the listed duty the model chose (the only one, when the owner wrote
 *   one). With a chat model both come from `generateObject`. Rejects on a malformed or refused
 *   score; the policy turns a rejection into a degraded abstain, which never wakes the bot. A
 *   refused or `none` choice of duty only loses the name, not the score.
 */
export const createWakeDutyJudge = ({
  agentId,
  db,
  engine = DEFAULT_BOT_WAKE_ENGINE,
  model = DEFAULT_BOT_WAKE_MODEL,
  provider = DEFAULT_BOT_WAKE_PROVIDER,
  userId,
  workspaceId,
}: CreateWakeClassifyOptions): WakeDutyJudge => {
  const getRuntime = createRuntimeCache({ db, provider, userId, workspaceId });
  const tracing = (schemaName: string) =>
    ({
      agentId,
      promptVersion: BOT_WAKE_DUTY_PROMPT_VERSION,
      scenario: TRACING_SCENARIOS.BotWakeClassifier,
      schemaName,
    }) satisfies TracingOptions;

  return async (judgeInput, abortSignal): Promise<WakeDutyJudgement> => {
    const input = { ...toPromptInput(judgeInput), duties: judgeInput.duties };
    const runtime = await getRuntime();

    log('duty engine=%s model=%s thread=%s', engine, model, judgeInput.signal.platformThreadId);

    if (engine === 'decision') {
      const { duties, questions, state } = chainBotWakeDutyDecision(input);
      const response = await runtime.decide(
        { model, questions, state },
        {
          metadata: { trigger: RequestTrigger.Bot },
          signal: abortSignal,
          tracing: tracing('bot_wake_duty_decision'),
        },
      );
      const { duty, inDuty } = response.answers;
      if (inDuty.type !== 'boolean') {
        throw new Error(
          `decision model refused: ${(inDuty as { reason?: string }).reason ?? 'no reason'}`,
        );
      }
      const probability = ProbabilitySchema.parse(inDuty.probability);
      const listed = Object.values(duties);
      const matched =
        listed.length === 1
          ? listed[0]
          : duty?.type === 'choice'
            ? duties[duty.choice as keyof typeof duties]
            : undefined;

      return {
        duty: shortDuty(matched),
        inDuty: probability,
        reason: `${model} p=${probability.toFixed(2)}`,
      };
    }

    const chain = chainBotWakeDutyClassifier(input);
    const result = await runtime.generateObject(
      {
        messages: chain.messages as GenerateObjectPayload['messages'],
        model,
        schema: BOT_WAKE_DUTY_JSON_SCHEMA,
      },
      {
        metadata: { trigger: RequestTrigger.Bot },
        signal: abortSignal,
        tracing: tracing(BOT_WAKE_DUTY_JSON_SCHEMA.name),
      },
    );
    const { duty, inDuty, reason } = DutySchema.parse(result);

    return { duty: shortDuty(duty), inDuty, reason };
  };
};
