import { DEFAULT_MINI_MODEL, DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { GenerateObjectPayload, ModelRuntime } from '@lobechat/model-runtime';
import {
  chainChannelReplyOpener,
  CHANNEL_REPLY_OPENER_JSON_SCHEMA,
  CHANNEL_REPLY_OPENER_MAX_ACK_LENGTH,
  CHANNEL_REPLY_OPENER_MAX_TITLE_LENGTH,
  CHANNEL_REPLY_OPENER_PROMPT_VERSION,
  CHANNEL_REPLY_PLACEMENTS,
  type ChannelReplyOpenerInput,
} from '@lobechat/prompts';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const log = debug('lobe-server:channel:opener');

/**
 * How long a job waits for its opener before starting in place. The run starts only after it, so
 * every second here is a second without a reply.
 */
export const CHANNEL_REPLY_OPENER_TIMEOUT_MS = 5000;

/** Preparing a runtime reads provider keys from the DB; reuse it for a while. */
const RUNTIME_TTL_MS = 5 * 60 * 1000;

const OpenerSchema = z.object({
  ack: z.string(),
  acknowledge: z.boolean(),
  placement: z.enum(CHANNEL_REPLY_PLACEMENTS),
  thread: z.string(),
  title: z.string(),
});

/** How a Channel reply opens, as the model decided it and cleaned up. */
export type ChannelReplyOpening =
  | { ack?: string; placement: 'channel' }
  | { ack?: string; placement: 'thread'; title: string }
  /** `thread` is the label of one of the Threads the opener was shown. */
  | { ack?: string; placement: 'existing_thread'; thread: string };

export type ChannelReplyOpener = (
  input: ChannelReplyOpenerInput,
  abortSignal: AbortSignal,
) => Promise<ChannelReplyOpening>;

export interface CreateChannelReplyOpenerOptions {
  agentId?: string;
  channelId?: string;
  db: LobeChatDatabase;
  /** Model override; defaults to the deployment's mini model. */
  model?: string;
  provider?: string;
  userId: string;
  workspaceId?: string;
}

const oneLine = (text: string, max: number) => text.replaceAll(/\s+/g, ' ').trim().slice(0, max);

const NESTED_ACK = /"ack"\s*:\s*"((?:[^"\\]|\\.)*)"/;

/**
 * The sentence to post, from the model's `ack`. A model sometimes writes its whole answer, JSON and
 * all, into that one field, often with stray text after it; posting it would put raw JSON in the
 * Channel. Only the sentence inside is kept, and an `ack` that is JSON without one posts nothing.
 */
const ackSentence = (ack: string) => {
  const text = ack.trim();
  if (!text.startsWith('{')) return text;

  const nested = NESTED_ACK.exec(text)?.[1];
  if (!nested) return '';
  try {
    return JSON.parse(`"${nested}"`) as string;
  } catch {
    return '';
  }
};

/**
 * Turns the model's answer into something safe to act on: a new Thread needs a title, an existing
 * one must be among those the opener was shown, and an acknowledgement needs words, not JSON.
 * Anything else answers in place.
 */
export const normalizeChannelReplyOpening = (
  answer: z.infer<typeof OpenerSchema>,
  input: Pick<ChannelReplyOpenerInput, 'canOpenThread' | 'coAddressed' | 'threads'>,
): ChannelReplyOpening => {
  const ack = answer.acknowledge
    ? oneLine(ackSentence(answer.ack), CHANNEL_REPLY_OPENER_MAX_ACK_LENGTH)
    : '';
  const opening = { ...(ack && { ack }) };
  if (!input.canOpenThread) return { ...opening, placement: 'channel' };

  if (answer.placement === 'existing_thread' && !input.coAddressed?.length) {
    const label = answer.thread.trim();
    if (input.threads?.some((thread) => thread.label === label))
      return { ...opening, placement: 'existing_thread', thread: label };
  }
  const title = oneLine(answer.title, CHANNEL_REPLY_OPENER_MAX_TITLE_LENGTH);
  if (answer.placement === 'thread' && title) return { ...opening, placement: 'thread', title };
  return { ...opening, placement: 'channel' };
};

/**
 * Builds the model call that opens an Agent's Channel reply: whether to acknowledge first, with
 * which sentence, and whether to answer in place, in a new Thread, or in an open one.
 *
 * Use when:
 * - A Channel job is about to open its reply (see `openChannelReply`)
 *
 * Expects:
 * - The caller applies the deadline and passes the abort signal on
 *
 * Returns:
 * - A `ChannelReplyOpener` that goes through `generateObject` under the `channel_reply_opener`
 *   tracing scenario. Rejects on a malformed answer; the caller then starts in place.
 */
export const createChannelReplyOpener = ({
  agentId,
  channelId,
  db,
  model = DEFAULT_MINI_MODEL,
  provider = DEFAULT_MINI_PROVIDER,
  userId,
  workspaceId,
}: CreateChannelReplyOpenerOptions): ChannelReplyOpener => {
  let prepared: { expiresAt: number; runtime: Promise<ModelRuntime> } | undefined;

  const getRuntime = (): Promise<ModelRuntime> => {
    if (!prepared || prepared.expiresAt <= Date.now()) {
      const runtime = initModelRuntimeFromDB(db, userId, provider, workspaceId);
      const entry = { expiresAt: Date.now() + RUNTIME_TTL_MS, runtime };
      prepared = entry;
      // A failure must not stick: the next job prepares it again.
      runtime.catch(() => {
        if (prepared === entry) prepared = undefined;
      });
    }

    return prepared.runtime;
  };

  return async (input, abortSignal) => {
    log(
      'open model=%s provider=%s canOpenThread=%s threads=%d',
      model,
      provider,
      input.canOpenThread,
      input.threads?.length ?? 0,
    );
    const runtime = await getRuntime();
    const { messages } = chainChannelReplyOpener(input);

    const result = await runtime.generateObject(
      {
        messages: messages as GenerateObjectPayload['messages'],
        model,
        schema: CHANNEL_REPLY_OPENER_JSON_SCHEMA,
      },
      {
        metadata: { ...(channelId && { channelId }), trigger: 'channel' },
        signal: abortSignal,
        tracing: {
          agentId,
          promptVersion: CHANNEL_REPLY_OPENER_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.ChannelReplyOpener,
          schemaName: CHANNEL_REPLY_OPENER_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );

    return normalizeChannelReplyOpening(OpenerSchema.parse(result), input);
  };
};
