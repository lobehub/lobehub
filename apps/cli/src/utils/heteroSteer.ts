import type { AgentContentBlock, AgentPromptInput } from '@lobechat/heterogeneous-agents/spawn';

import { cliVersion } from '../pkg';
import { log } from './logger';

/** The part of the lambda client the steer loop calls. */
export interface HeteroSteerClient {
  aiAgent: {
    returnHeteroSteer: {
      mutate: (input: { messageId: string; operationId: string }) => Promise<unknown>;
    };
    waitHeteroSteer: {
      mutate: (
        input: {
          acceptsAttachedImages?: boolean;
          acceptsImages?: boolean;
          blockMs?: number;
          cliVersion?: string;
          operationId: string;
        },
        options?: { signal?: AbortSignal },
      ) => Promise<{
        message: HeteroSteerMessage | null;
        /** `false` for a run the user does not type into (a child run): stop polling. */
        steerable?: false;
      }>;
    };
  };
}

/** A follow-up to type into the session, with its attached and pasted images. */
export interface HeteroSteerMessage {
  content: string;
  /**
   * `attached` marks an attachment: unlike a pasted image, the text does not
   * name it, so the text alone is no fallback when it cannot be sent.
   */
  imageList?: { attached?: boolean; id: string; url: string }[];
  messageId: string;
}

/** The prompt a follow-up is typed in as: its text, then its images as image blocks. */
export const buildSteerPrompt = (message: HeteroSteerMessage): AgentPromptInput => {
  const images = message.imageList ?? [];
  if (images.length === 0) return message.content;
  return [
    { text: message.content, type: 'text' },
    ...images.map(({ id, url }): AgentContentBlock => ({
      source: { id, type: 'url', url },
      type: 'image',
    })),
  ];
};

/**
 * What the steer loop did, for the run's local trace: whether follow-ups
 * reached the session, and why the loop stopped asking. Without it a queue
 * that never moves cannot be told apart from one the server holds back.
 */
export type HeteroSteerTraceEvent =
  | { cliVersion?: string; type: 'steer_listening' }
  /** `images`: how many went in as image blocks (0 when they fell back to text). */
  | { images: number; messageId: string; type: 'steer_delivered' }
  | { messageId: string; type: 'steer_returned' }
  | {
      error?: string;
      reason: 'child_run' | 'images_failed' | 'input_closed' | 'refused';
      type: 'steer_stopped';
    };

export interface HeteroSteerContext {
  /** Reported with every poll, so the server can say which `lh` a stuck queue sits behind. */
  cliVersion?: string;
  getTrpcClient: () => Promise<HeteroSteerClient>;
  /** Best-effort trace sink; never throws into the loop. */
  onTrace?: (event: HeteroSteerTraceEvent) => void;
  operationId: string;
}

/**
 * The steer context of a server-ingested run: reports this `lh` version with
 * every poll and notes what the loop did on the run's local trace, since steer
 * delivery happens outside the agent stream the trace otherwise records.
 */
export const heteroSteerContext = ({
  getTrpcClient,
  operationId,
  traceRecorder,
}: {
  getTrpcClient: () => Promise<HeteroSteerClient>;
  operationId: string;
  traceRecorder: { note: (type: string, data: Record<string, unknown>) => void };
}): HeteroSteerContext => ({
  cliVersion,
  getTrpcClient,
  onTrace: ({ type, ...data }) => traceRecorder.note(type, data),
  operationId,
});

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

const IMAGE_CAPABILITIES = { acceptsAttachedImages: true, acceptsImages: true } as const;

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

  const { cliVersion, operationId } = context;
  const trace = (event: HeteroSteerTraceEvent) => {
    try {
      context.onTrace?.(event);
    } catch {
      // A trace failure must never stop delivery.
    }
  };
  const delivered = new Set<string>();
  const abort = new AbortController();
  // Set once the server answered a poll; the next main `stream_start` tells
  // the client, so an older server never gets its queue hint changed.
  let supported = false;
  let markedLive = false;

  const poll = async () => {
    const client = await context.getTrpcClient();
    while (!abort.signal.aborted) {
      let message: HeteroSteerMessage | null;
      try {
        const res = await client.aiAgent.waitHeteroSteer.mutate(
          // The first poll answers at once, so the run is marked steerable early.
          // The session takes image blocks, so pasted and attached images come
          // along; a failed attachment goes back rather than as text alone.
          supported
            ? { ...IMAGE_CAPABILITIES, cliVersion, operationId }
            : { ...IMAGE_CAPABILITIES, blockMs: 1, cliVersion, operationId },
          { signal: abort.signal },
        );
        if (res.steerable === false) {
          trace({ reason: 'child_run', type: 'steer_stopped' });
          return;
        }
        message = res.message;
        if (!supported) trace({ cliVersion, type: 'steer_listening' });
        supported = true;
      } catch (error) {
        if (abort.signal.aborted) return;
        if (isPermanentRefusal(error)) {
          log.debug('Steer delivery unavailable for this run: %s', String(error));
          trace({ error: String(error), reason: 'refused', type: 'steer_stopped' });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        continue;
      }
      if (!message) continue;

      const steer = message;
      const options = { uuid: steer.messageId };
      let images = steer.imageList?.length ?? 0;
      let imagesFailed = false;
      const accepted = await send(buildSteerPrompt(steer), options).catch(async (error) => {
        if (!steer.imageList?.length) return false;
        if (steer.imageList.some((image) => image.attached)) {
          // The text does not name an attachment: sent alone, the agent would
          // miss it while the chat shows it. Images are fetched before
          // anything is typed, so the message can still wait for its own turn.
          log.debug('Steer attachments failed, returning the message: %s', String(error));
          imagesFailed = true;
          return false;
        }
        // An image that cannot be fetched must not cost the message: its
        // markdown still names the image.
        log.debug('Steer images failed, sending the text: %s', String(error));
        images = 0;
        return send(steer.content, options).catch(() => false);
      });
      if (accepted) {
        delivered.add(message.messageId);
        trace({
          images,
          messageId: steer.messageId,
          type: 'steer_delivered',
        });
        continue;
      }
      // The session stopped taking input, or could not take the attachments:
      // whatever is queued now waits for the run to end, as before. Polling
      // on after a failed attachment would take the same message again.
      trace({ messageId: steer.messageId, type: 'steer_returned' });
      await client.aiAgent.returnHeteroSteer
        .mutate({ messageId: message.messageId, operationId })
        .catch((error) => log.debug('Returning steer message failed: %s', String(error)));
      trace({ reason: imagesFailed ? 'images_failed' : 'input_closed', type: 'steer_stopped' });
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
