// Built-in control commands register themselves when the steer loop loads.
import './heteroPermissionMode';
import './heteroStopTask';

import type {
  AgentContentBlock,
  AgentPromptInput,
  ClaudeCodeControlRequest,
  ClaudeCodeControlRequestHandle,
} from '@lobechat/heterogeneous-agents/spawn';

import {
  dispatchHeteroControl,
  type HeteroControlMessage,
  type HeteroControlReport,
} from './heteroControl';
import { log } from './logger';

/** The part of the lambda client the steer loop calls. */
export interface HeteroSteerClient {
  aiAgent: {
    /** Absent on a client that predates control messages. */
    reportHeteroControlResult?: {
      mutate: (
        input: { controlId: string; operationId: string } & HeteroControlReport,
      ) => Promise<unknown>;
    };
    returnHeteroSteer: {
      mutate: (input: { messageId: string; operationId: string }) => Promise<unknown>;
    };
    waitHeteroSteer: {
      mutate: (
        input: {
          acceptsControl?: boolean;
          acceptsImageAttachments?: boolean;
          acceptsImages?: boolean;
          blockMs?: number;
          holdSteer?: boolean;
          operationId: string;
        },
        options?: { signal?: AbortSignal },
      ) => Promise<{
        /**
         * The next control message, or `null`. Present only when the server
         * delivers control messages (the poll declared `acceptsControl`).
         */
        control?: HeteroControlMessage | null;
        message: HeteroSteerMessage | null;
        /**
         * `false` for a run the user does not type into (a child run). It
         * takes no follow-ups; without `control` on the answer, stop polling.
         */
        steerable?: false;
      }>;
    };
  };
}

/** A follow-up to type into the session, including uploaded and inline images. */
export interface HeteroSteerMessage {
  content: string;
  imageList?: { id: string; url: string }[];
  messageId: string;
  requiresImages?: true;
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

export interface HeteroSteerContext {
  getTrpcClient: () => Promise<HeteroSteerClient>;
  /** Whether the session waits for the user (a question or an approval): nothing is steered then. */
  isWaitingForUser?: () => boolean;
  operationId: string;
}

interface SteerableHandle {
  events: AsyncIterable<any>;
  sendControlRequest?: (
    request: ClaudeCodeControlRequest,
  ) => ClaudeCodeControlRequestHandle | undefined;
  sendUserMessage?: (prompt: AgentPromptInput, options?: { uuid?: string }) => Promise<boolean>;
  supportsSteerImageAttachments?: true;
  supportsSteerImages?: boolean;
}

const RETRY_MS = 2000;
const REPORT_ATTEMPTS = 3;
/** How long the end of a run waits for control handlers still running. */
const CONTROL_SETTLE_MS = 10_000;

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
 * Stream a Claude Code or native Codex run's events while typing the
 * follow-ups the user queues behind it into the live session (steer), instead
 * of leaving them for the next turn.
 *
 * Polls `aiAgent.waitHeteroSteer` for as long as the run streams and its
 * session takes input; a message the session refuses goes back with
 * `aiAgent.returnHeteroSteer`. The agent reports every message it picks up
 * (Claude Code replays it, Codex echoes its client id):
 * the replay of a delivery is forwarded for the server to write the message
 * into the conversation; any other replay (the run's own prompt) is dropped.
 * Once the server answered, the next main `stream_start` carries `liveSteer`
 * so the client knows the run's queue no longer waits for the run to end.
 *
 * The same poll carries the server's control messages (`acceptsControl`):
 * each goes to its handler in the `heteroControl` registry, which can write
 * control requests into the session, and its outcome goes back with
 * `aiAgent.reportHeteroControlResult`. A child run takes no follow-ups, but
 * keeps polling for control messages when the server delivers them.
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
  const sendControlRequest = handle.sendControlRequest;
  const delivered = new Set<string>();
  const abort = new AbortController();
  const handling = new Set<Promise<void>>();
  // Set once the server answered a poll; the next poll may hold.
  let answered = false;
  // Set once the server answered a poll for a run the user types into; the
  // next main `stream_start` tells the client, so an older server never gets
  // its queue hint changed.
  let supported = false;
  let markedLive = false;
  // While the session waits on a question or approval nothing is steered.
  const waitingForUser = () => !!context.isWaitingForUser?.();

  const report = async (
    client: HeteroSteerClient,
    control: HeteroControlMessage,
    outcome: HeteroControlReport,
  ) => {
    const reportResult = client.aiAgent.reportHeteroControlResult;
    if (!reportResult) return;
    for (let attempt = 1; ; attempt++) {
      try {
        await reportResult.mutate({ controlId: control.id, operationId, ...outcome });
        return;
      } catch (error) {
        if (isPermanentRefusal(error) || attempt >= REPORT_ATTEMPTS) {
          log.debug('Reporting control %s failed: %s', control.id, String(error));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  };

  // Handled alongside the poll, so a slow handler does not hold follow-ups.
  const handleControl = (client: HeteroSteerClient, control: HeteroControlMessage) => {
    const task = (async () => {
      log.debug('Control %s: %s', control.id, control.command);
      const outcome = await dispatchHeteroControl(control, {
        operationId,
        sendControlRequest: sendControlRequest!,
        signal: abort.signal,
      });
      await report(client, control, outcome);
    })()
      .catch((error) => log.debug('Control %s failed: %s', control.id, String(error)))
      .finally(() => handling.delete(task));
    handling.add(task);
  };

  const poll = async () => {
    const client = await context.getTrpcClient();
    // Control messages need a way into the session and back to the server.
    const acceptsControl = !!sendControlRequest && !!client.aiAgent.reportHeteroControlResult;
    while (!abort.signal.aborted) {
      let message: HeteroSteerMessage | null;
      try {
        const res = await client.aiAgent.waitHeteroSteer.mutate(
          {
            ...(acceptsControl && { acceptsControl: true }),
            ...(handle.supportsSteerImageAttachments && { acceptsImageAttachments: true }),
            // The session takes image blocks, so pasted images come along.
            ...(handle.supportsSteerImages !== false && { acceptsImages: true }),
            // The first poll answers at once, so the run is marked steerable early.
            ...(!answered && { blockMs: 1 }),
            ...(waitingForUser() && { holdSteer: true }),
            operationId,
          },
          { signal: abort.signal },
        );
        // An older server answers a child run at once without `control`: stop.
        if (res.steerable === false && !(acceptsControl && res.control !== undefined)) return;
        answered = true;
        if (res.steerable !== false) supported = true;
        if (res.control) handleControl(client, res.control);
        message = res.message;
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
      // Handed out just as the session started waiting for the user: it goes
      // back, and comes again once the user answered.
      if (waitingForUser()) {
        await client.aiAgent.returnHeteroSteer
          .mutate({ messageId: message.messageId, operationId })
          .catch((error) => log.debug('Returning steer message failed: %s', String(error)));
        continue;
      }

      const steer = message;
      const options = { uuid: steer.messageId };
      const accepted = await send(buildSteerPrompt(steer), options).catch(async (error) => {
        if (steer.requiresImages || !steer.imageList?.length) return false;
        // An image that cannot be fetched must not cost the message: its
        // markdown still names the image.
        log.debug('Steer images failed, sending the text: %s', String(error));
        return send(steer.content, options).catch(() => false);
      });
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
    // Let handlers still running report how they ended, within a bound: the
    // run must end even if one hangs.
    if (handling.size > 0) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(handling),
        new Promise((resolve) => {
          timer = setTimeout(resolve, CONTROL_SETTLE_MS);
          timer.unref?.();
        }),
      ]);
      clearTimeout(timer);
    }
  }
}
