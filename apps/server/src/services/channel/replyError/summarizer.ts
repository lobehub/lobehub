import { DEFAULT_MINI_MODEL, DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { GenerateObjectPayload } from '@lobechat/model-runtime';
import {
  chainChannelReplyError,
  CHANNEL_REPLY_ERROR_ACTIONS,
  CHANNEL_REPLY_ERROR_JSON_SCHEMA,
  CHANNEL_REPLY_ERROR_MAX_SUMMARY_LENGTH,
  CHANNEL_REPLY_ERROR_PROMPT_VERSION,
  type ChannelReplyErrorInput,
} from '@lobechat/prompts';
import type { ChannelReplyErrorAction } from '@lobechat/types';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

/** How long the card waits for a better explanation; the rule-based one is already posted. */
export const CHANNEL_REPLY_ERROR_SUMMARY_TIMEOUT_MS = 10_000;

const AnswerSchema = z.object({
  actions: z.array(z.enum(CHANNEL_REPLY_ERROR_ACTIONS)),
  summary: z.string(),
});

export interface ChannelReplyErrorRefinement {
  actions: ChannelReplyErrorAction[];
  summary: string;
}

export type ChannelReplyErrorSummarizer = (
  input: ChannelReplyErrorInput,
  abortSignal: AbortSignal,
) => Promise<ChannelReplyErrorRefinement | undefined>;

/**
 * Keeps only what the server can act on: allowed actions, in the model's order, without
 * duplicates, and a one-line sentence. Undefined when either is empty, so the rule-based card
 * stays.
 */
export const normalizeReplyErrorAnswer = (
  answer: z.infer<typeof AnswerSchema>,
  allowed: ChannelReplyErrorAction[],
): ChannelReplyErrorRefinement | undefined => {
  const summary = answer.summary
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, CHANNEL_REPLY_ERROR_MAX_SUMMARY_LENGTH);
  const actions = [...new Set(answer.actions)].filter((action) => allowed.includes(action));
  if (!summary || !actions.length) return;
  return { actions, summary };
};

/**
 * The deployment's mini model, run as the requester like the reply opener, under the
 * `channel_reply_error` tracing scenario. Rejects on a malformed answer.
 */
export const createChannelReplyErrorSummarizer = ({
  agentId,
  channelId,
  db,
  userId,
  workspaceId,
}: {
  agentId?: string;
  channelId: string;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}): ChannelReplyErrorSummarizer => {
  return async (input, abortSignal) => {
    const runtime = await initModelRuntimeFromDB(db, userId, DEFAULT_MINI_PROVIDER, workspaceId);
    const { messages } = chainChannelReplyError(input);
    const result = await runtime.generateObject(
      {
        messages: messages as GenerateObjectPayload['messages'],
        model: DEFAULT_MINI_MODEL,
        schema: CHANNEL_REPLY_ERROR_JSON_SCHEMA,
      },
      {
        metadata: { channelId, trigger: 'channel' },
        signal: abortSignal,
        tracing: {
          agentId,
          promptVersion: CHANNEL_REPLY_ERROR_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.ChannelReplyError,
          schemaName: CHANNEL_REPLY_ERROR_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );
    return normalizeReplyErrorAnswer(AnswerSchema.parse(result), input.allowedActions);
  };
};
