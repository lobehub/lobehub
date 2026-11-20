import { AsyncLocalStorage } from 'node:async_hooks';

import {
  isOwnLlmRelayChannelId,
  LLM_RELAY_CHANNEL_HEADER,
  LLM_RELAY_CLIENT_ID_HEADER,
} from '@lobechat/agent-gateway-client';
import debug from 'debug';

import type { IStreamEventManager } from '../types';

const log = debug('lobe-server:agent-runtime:llm-relay:request');

/**
 * Request side of the one-shot relay (see `oneShot.ts`): which tab a request
 * came from and the gateway channel it subscribed for the request's relayed
 * LLM calls. Carried through the request in an `AsyncLocalStorage`, so a
 * service deep in the call tree relays without every signature passing it on.
 */

/** What a request carries to have its LLM calls relayed back to its tab. */
export interface LlmRelayRequest {
  /** The one-shot channel the tab subscribed to. */
  channel: string;
  /** The tab's client id, the call's preferred executor. */
  clientId: string;
}

const MAX_CLIENT_ID_LENGTH = 128;

/** The relay request a set of request headers describes, if any. */
export const readLlmRelayRequest = (headers: {
  get: (name: string) => string | null;
}): LlmRelayRequest | undefined => {
  const channel = headers.get(LLM_RELAY_CHANNEL_HEADER)?.trim();
  const clientId = headers.get(LLM_RELAY_CLIENT_ID_HEADER)?.trim();
  if (!channel || !clientId || clientId.length > MAX_CLIENT_ID_LENGTH) return;

  return { channel, clientId };
};

/**
 * The relay channel of one request. Opened on the gateway by the first call
 * that needs it, closed when the request ends; calls after that have no tab
 * waiting for them.
 */
export class LlmRelayRequestScope {
  ended = false;
  private calls = 0;
  private opened?: Promise<void>;
  private streamManager?: IStreamEventManager;

  constructor(
    readonly request: LlmRelayRequest,
    readonly userId: string,
  ) {}

  nextCallId() {
    this.calls += 1;
    return `${this.request.channel}:${this.calls}`;
  }

  open(streamManager: IStreamEventManager) {
    if (!this.opened) {
      this.streamManager = streamManager;
      this.opened = streamManager.openLlmRelayChannel!(this.request.channel, this.userId);
    }
    return this.opened;
  }

  async end() {
    if (this.ended) return;
    this.ended = true;
    if (!this.opened) return;

    try {
      await this.opened;
    } catch {
      return;
    }
    await this.streamManager?.closeLlmRelayChannel?.(this.request.channel);
  }
}

const scopeStorage = new AsyncLocalStorage<LlmRelayRequestScope>();

/** The relay scope of the request this code runs for, if it came from a tab that set one up. */
export const getLlmRelayRequestScope = () => scopeStorage.getStore();

const createScope = (request: LlmRelayRequest | undefined, userId: string | null | undefined) => {
  if (!request || !userId) return;
  // Only the caller's own channels: anything else could name a real run's
  // operation or another user's channel, which the gateway would re-own.
  if (!isOwnLlmRelayChannelId(request.channel, userId)) {
    log('ignoring relay channel %s not owned by %s', request.channel, userId);
    return;
  }
  return new LlmRelayRequestScope(request, userId);
};

/**
 * Run `fn` as a request whose relayed LLM calls go back to the tab described
 * by `request`. The channel closes once `fn` settles — the response is
 * complete then (TRPC) — without holding the response up.
 */
export const runWithLlmRelayRequest = async <T>(
  request: LlmRelayRequest | undefined,
  userId: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> => {
  const scope = createScope(request, userId);
  if (!scope) return fn();

  try {
    return await scopeStorage.run(scope, fn);
  } finally {
    void scope.end();
  }
};

/**
 * {@link runWithLlmRelayRequest} for a route that streams its response: the
 * channel stays open until the body is fully read or cancelled.
 */
export const runRouteWithLlmRelayRequest = async (
  req: Request,
  userId: string,
  fn: () => Promise<Response>,
): Promise<Response> => {
  const scope = createScope(readLlmRelayRequest(req.headers), userId);
  if (!scope) return fn();

  let response: Response;
  try {
    response = await scopeStorage.run(scope, fn);
  } catch (error) {
    void scope.end();
    throw error;
  }
  if (!response.body) {
    void scope.end();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    cancel: async (reason) => {
      void scope.end();
      await reader.cancel(reason);
    },
    pull: async (controller) => {
      try {
        const { done, value } = await reader.read();
        if (done) {
          void scope.end();
          return controller.close();
        }
        controller.enqueue(value);
      } catch (error) {
        void scope.end();
        controller.error(error);
      }
    },
  });

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};
