import type { AgentPromptInput } from '@lobechat/heterogeneous-agents/spawn';

import { log } from './logger';

/** The part of the lambda client the steer loop calls. */
export interface HeteroSteerClient {
  aiAgent: {
    returnHeteroSteer: {
      mutate: (input: { messageId: string; operationId: string }) => Promise<unknown>;
    };
    waitHeteroSteer: {
      mutate: (
        input: { blockMs?: number; operationId: string },
        options?: { signal?: AbortSignal },
      ) => Promise<{
        message: { content: string; messageId: string } | null;
        /** `false` for a run the user does not type into (a child run): stop polling. */
        steerable?: false;
      }>;
    };
  };
}

export interface HeteroSteerContext {
  getTrpcClient: () => Promise<HeteroSteerClient>;
  operationId: string;
}

interface SteerableHandle {
  events: AsyncIterable<any>;
  sendUserMessage?: (prompt: AgentPromptInput, options?: { uuid?: string }) => Promise<boolean>;
}

const RETRY_MS = 2000;

/** The server predates steer delivery, or refuses it for this run: stop asking. */
const isPermanentRefusal = (error: unknown) => {
  const code = (error as { data?: { code?: string } } | undefined)?.data?.code;
  return code === 'NOT_FOUND' || code === 'FORBIDDEN' || code === 'BAD_REQUEST';
};

const isUserMessageReplay = (event: { data?: any; type: string }) =>
  event.type === 'step_complete' &&
  event.data?.phase === 'user_message' &&
  typeof event.data?.uuid === 'string';

const isMainStreamStart = (event: { data?: any; type: string }) =>
  event.type === 'stream_start' && !event.data?.subagent;

/**
 * Stream a Claude Code run's events while typing the follow-ups the user
 * queues behind it into the live session (steer), instead of leaving them for
 * the next turn.
 *
 * Polls `aiAgent.waitHeteroSteer` for as long as the run streams and its
 * session takes input; a message the session refuses goes back with
 * `aiAgent.returnHeteroSteer`. Claude Code replays every message it picks up:
 * the replay of a delivery is forwarded for the server to write the message
 * into the conversation; any other replay (the run's own prompt) is dropped.
 * Once the server answered, the next main `stream_start` carries `liveSteer`
 * so the client knows the run's queue no longer waits for the run to end.
 *
 * Without a server context or a live session, events pass through unchanged.
 */
export async function* withHeteroSteer<E extends { data?: any; type: string }>(
  handle: SteerableHandle & { events: AsyncIterable<E> },
  context: HeteroSteerContext | undefined | false,
): AsyncGenerator<E> {
  const send = handle.sendUserMessage;
  if (!context || !send) {
    yield* handle.events;
    return;
  }

  const { operationId } = context;
  const delivered = new Set<string>();
  const abort = new AbortController();
  // Set once the server answered a poll; the next main `stream_start` tells
  // the client, so an older server never gets its queue hint changed.
  let supported = false;
  let markedLive = false;

  const poll = async () => {
    const client = await context.getTrpcClient();
    while (!abort.signal.aborted) {
      let message: { content: string; messageId: string } | null;
      try {
        const res = await client.aiAgent.waitHeteroSteer.mutate(
          // The first poll answers at once, so the run is marked steerable early.
          supported ? { operationId } : { blockMs: 1, operationId },
          { signal: abort.signal },
        );
        if (res.steerable === false) return;
        message = res.message;
        supported = true;
      } catch (error) {
        if (abort.signal.aborted) return;
        if (isPermanentRefusal(error)) {
          log.debug('Steer delivery unavailable for this run: %s', String(error));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        continue;
      }
      if (!message) continue;

      const accepted = await send(message.content, { uuid: message.messageId }).catch(() => false);
      if (accepted) {
        delivered.add(message.messageId);
        continue;
      }
      // The session stopped taking input; whatever is queued now waits for
      // the run to end, as before.
      await client.aiAgent.returnHeteroSteer
        .mutate({ messageId: message.messageId, operationId })
        .catch((error) => log.debug('Returning steer message failed: %s', String(error)));
      return;
    }
  };

  const polling = poll().catch((error) => log.debug('Steer polling stopped: %s', String(error)));
  try {
    for await (const event of handle.events) {
      if (isUserMessageReplay(event)) {
        if (delivered.delete(event.data.uuid)) yield event;
        continue;
      }
      if (supported && !markedLive && isMainStreamStart(event)) {
        markedLive = true;
        yield { ...event, data: { ...event.data, liveSteer: true } };
        continue;
      }
      yield event;
    }
  } finally {
    abort.abort();
    await polling;
  }
}
