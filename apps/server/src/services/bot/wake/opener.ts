import { DEFAULT_MINI_MODEL, DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { GenerateObjectPayload, ModelRuntime } from '@lobechat/model-runtime';
import {
  BOT_REPLY_OPENER_JSON_SCHEMA,
  BOT_REPLY_OPENER_MAX_ACK_LENGTH,
  BOT_REPLY_OPENER_MAX_TITLE_LENGTH,
  BOT_REPLY_OPENER_PROMPT_VERSION,
  BOT_REPLY_PLACEMENTS,
  type BotReplyOpenerInput,
  type BotReplyPlacement,
  chainBotReplyOpener,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const log = debug('lobe-server:bot:reply-opener');

/** Same reuse window as the wake classifier: preparing a runtime reads provider keys from the DB. */
const RUNTIME_TTL_MS = 5 * 60 * 1000;

const OpenerSchema = z.object({
  ack: z.string(),
  acknowledge: z.boolean(),
  placement: z.enum(BOT_REPLY_PLACEMENTS),
  title: z.string(),
});

/** How the bot opens its reply, as the model decided it and cleaned up. */
export interface ReplyOpening {
  /** The acknowledgement to post before the run; absent when the bot answers right away. */
  ack?: string;
  placement: BotReplyPlacement;
  /** The thread's name; present only with `placement: 'thread'`. */
  title?: string;
}

export type ReplyOpener = (
  input: BotReplyOpenerInput,
  abortSignal: AbortSignal,
) => Promise<ReplyOpening>;

export interface CreateReplyOpenerOptions {
  agentId?: string;
  db: LobeChatDatabase;
  /** Model override; defaults to the deployment's mini model. */
  model?: string;
  provider?: string;
  userId: string;
  workspaceId?: string;
}

const oneLine = (text: string, max: number) => text.replaceAll(/\s+/g, ' ').trim().slice(0, max);

/**
 * Turns the model's answer into something safe to act on: a thread needs a title and a place to
 * open it, and an acknowledgement needs words.
 */
export const normalizeReplyOpening = (
  answer: z.infer<typeof OpenerSchema>,
  canOpenThread: boolean,
): ReplyOpening => {
  const ack = answer.acknowledge ? oneLine(answer.ack, BOT_REPLY_OPENER_MAX_ACK_LENGTH) : '';
  const title = oneLine(answer.title, BOT_REPLY_OPENER_MAX_TITLE_LENGTH);
  const placement: BotReplyPlacement =
    canOpenThread && answer.placement === 'thread' && title ? 'thread' : 'channel';

  return {
    ...(ack && { ack }),
    placement,
    ...(placement === 'thread' && { title }),
  };
};

/**
 * Builds the model call that opens a bot's reply: whether to acknowledge first, with which
 * sentence, and whether to answer in the channel or in a new thread.
 *
 * Use when:
 * - A bot was addressed and is about to start a run
 *
 * Expects:
 * - The caller applies the deadline and passes the abort signal on
 *
 * Returns:
 * - A `ReplyOpener` that goes through `generateObject` under the `bot_reply_opener` tracing
 *   scenario. Rejects on a malformed answer; the caller falls back to its configured default.
 */
export const createReplyOpener = ({
  agentId,
  db,
  model = DEFAULT_MINI_MODEL,
  provider = DEFAULT_MINI_PROVIDER,
  userId,
  workspaceId,
}: CreateReplyOpenerOptions): ReplyOpener => {
  let prepared: { expiresAt: number; runtime: Promise<ModelRuntime> } | undefined;

  const getRuntime = (): Promise<ModelRuntime> => {
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

  return async (input, abortSignal) => {
    log('open model=%s provider=%s canOpenThread=%s', model, provider, input.canOpenThread);
    const runtime = await getRuntime();
    const { messages } = chainBotReplyOpener(input);

    const result = await runtime.generateObject(
      {
        messages: messages as GenerateObjectPayload['messages'],
        model,
        schema: BOT_REPLY_OPENER_JSON_SCHEMA,
      },
      {
        metadata: { trigger: RequestTrigger.Bot },
        signal: abortSignal,
        tracing: {
          agentId,
          promptVersion: BOT_REPLY_OPENER_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.BotReplyOpener,
          schemaName: BOT_REPLY_OPENER_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );

    return normalizeReplyOpening(OpenerSchema.parse(result), input.canOpenThread);
  };
};
