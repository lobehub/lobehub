import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import urlJoin from 'url-join';

import { log } from './logger';

export interface AgentHistoryPage {
  available: boolean;
  events: Array<AgentStreamEvent & { id?: string }>;
  hasMore: boolean;
  nextCursor: string;
}

export interface AgentStreamAuth {
  /**
   * LobeHub server URL the gateway calls back to when verifying an apiKey
   * token (via `/api/v1/users/me`). Ignored for JWT.
   */
  serverUrl: string;
  token: string;
  /** How the gateway should verify `token`. */
  tokenType: 'jwt' | 'apiKey';
}

export interface AgentStreamTransportOptions {
  gatewayUrl: string;
  /** Called for every (re)connect so a long run picks up refreshed credentials. */
  getAuth: () => Promise<AgentStreamAuth>;
  maxRetries?: number;
  operationId: string;
  readHistory: (cursor: string, signal: AbortSignal) => Promise<AgentHistoryPage>;
}

/** A missing/truncated history is not a successful recovery or a retryable network outage. */
export class AgentStreamHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentStreamHistoryError';
  }
}

const DEFAULT_MAX_RETRIES = 6;
const CONNECT_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HISTORY_POLL_INTERVAL_MS = 5000;
const HISTORY_REQUEST_TIMEOUT_MS = 10_000;
const FATAL_TRPC_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND']);
const REDIS_ID = /^\d+-\d+$/;

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

const retryDelay = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 15_000);

/** Compare Redis stream ids numerically — lexical order breaks once the digit count changes. */
const isAfter = (id: string, cursor: string) => {
  const [time, sequence] = id.split('-').map(BigInt);
  const [lastTime, lastSequence = 0n] = cursor.split('-').map(BigInt);
  return time > lastTime || (time === lastTime && sequence > lastSequence);
};

/**
 * Reads the authoritative server journal forward from an exclusive cursor.
 * Concurrent wake-ups coalesce into one more pass; transient failures back off
 * until the next wake-up, fatal ones throw `AgentStreamHistoryError`.
 */
class AgentEventJournal {
  private abort?: AbortController;
  private cursor = '0';
  private failures = 0;
  private nextAttemptAt = 0;
  private pending = false;
  private reading = false;
  private stopped = false;

  constructor(
    private readonly options: AgentStreamTransportOptions & { maxRetries: number },
    /** Returns `true` once the event is terminal, which ends the stream. */
    private readonly onEvent: (event: AgentStreamEvent) => boolean,
  ) {}

  close() {
    this.stopped = true;
    this.abort?.abort();
  }

  /** Resolves `true` once a terminal event was delivered. */
  async catchUp(): Promise<boolean> {
    if (this.stopped || Date.now() < this.nextAttemptAt) return false;
    if (this.reading) {
      this.pending = true;
      return false;
    }
    this.reading = true;
    try {
      do {
        this.pending = false;
        if (await this.readToEnd()) return true;
      } while (this.pending && !this.stopped);
      this.failures = 0;
      this.nextAttemptAt = 0;
      return false;
    } catch (error) {
      if (this.stopped) return false;
      const failure = toError(error);
      log.debug(`Agent history recovery failed: ${failure.message}`);
      // tRPC auth/not-found responses must not be retried or masked by completion.
      const code = (error as { data?: { code?: string } })?.data?.code;
      if (
        failure instanceof AgentStreamHistoryError ||
        FATAL_TRPC_CODES.has(code ?? '') ||
        ++this.failures > this.options.maxRetries
      ) {
        throw new AgentStreamHistoryError(`Complete history recovery failed: ${failure.message}`);
      }
      // The periodic poll retries transient failures even if the Gateway never
      // sends another notification (including a lost terminal).
      this.nextAttemptAt = Date.now() + retryDelay(this.failures);
      return false;
    } finally {
      this.reading = false;
    }
  }

  private async readToEnd(): Promise<boolean> {
    let hasMore = true;
    while (hasMore && !this.stopped) {
      const page = await this.readPage();
      if (this.stopped) return false;
      if (!page.available)
        throw new AgentStreamHistoryError(
          'Agent event history expired, was trimmed, or is unavailable; complete recovery cannot be guaranteed',
        );
      for (const event of page.events) {
        if (!event.id || !REDIS_ID.test(event.id) || event.operationId !== this.options.operationId)
          throw new AgentStreamHistoryError('Invalid agent event history');
        // A retried page can overlap the previous one.
        if (!isAfter(event.id, this.cursor)) continue;
        this.cursor = event.id;
        if (this.onEvent(event)) return true;
      }
      if (page.nextCursor !== this.cursor || (page.hasMore && page.events.length === 0))
        throw new AgentStreamHistoryError('Agent history cursor did not advance consistently');
      hasMore = page.hasMore;
    }
    return false;
  }

  private async readPage(): Promise<AgentHistoryPage> {
    const abort = new AbortController();
    this.abort = abort;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.options.readHistory(this.cursor, abort.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error('Agent history request timed out'));
          }, HISTORY_REQUEST_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.abort = undefined;
    }
  }
}

/**
 * Gateway WebSocket used purely as a wake-up signal: every notification asks
 * the journal to catch up. Owns auth, heartbeat and bounded reconnects.
 */
class GatewayWakeChannel {
  private gatewayCursor = '';
  private heartbeat?: ReturnType<typeof setInterval>;
  private heartbeatPending = false;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private retries = 0;
  private stopped = false;
  private ws?: WebSocket;

  constructor(
    private readonly options: AgentStreamTransportOptions & { maxRetries: number },
    private readonly onWake: () => void,
    private readonly onFatal: (error: Error) => void,
  ) {}

  /** Real progress proves the run is reachable, so the reconnect budget starts over. */
  resetRetries() {
    this.retries = 0;
  }

  connect() {
    if (this.stopped) return;
    const url = urlJoin(
      this.options.gatewayUrl.replace(/^http/, 'ws'),
      `/ws?operationId=${encodeURIComponent(this.options.operationId)}`,
    );
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.reconnect(toError(error));
      return;
    }
    this.ws = socket;
    this.connectTimer = setTimeout(
      () => this.reconnect(new Error('Agent gateway connection/authentication timed out')),
      CONNECT_TIMEOUT_MS,
    );
    socket.onopen = () => void this.authenticate(socket);
    socket.onmessage = ({ data }) => {
      if (this.stopped || socket !== this.ws) return;
      try {
        this.handleMessage(socket, JSON.parse(String(data)));
      } catch (error) {
        this.onFatal(new Error(`Invalid agent gateway message: ${toError(error).message}`));
      }
    };
    socket.onerror = () => this.reconnect(new Error('Agent gateway WebSocket failed'));
    socket.onclose = (event) => {
      const error = new Error(
        `Agent gateway WebSocket closed before completion (code ${event.code}${event.reason ? `: ${event.reason}` : ''})`,
      );
      // 1008 is a policy violation (e.g. a foreign operation): retrying cannot help.
      if (event.code === 1008) this.onFatal(error);
      else this.reconnect(error);
    };
  }

  close() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.closeSocket();
  }

  private async authenticate(socket: WebSocket) {
    try {
      const { serverUrl, token, tokenType } = await this.options.getAuth();
      if (this.stopped || socket !== this.ws) return;
      socket.send(JSON.stringify({ serverUrl, token, tokenType, type: 'auth' }));
    } catch (error) {
      this.onFatal(new Error(`Agent gateway credentials unavailable: ${toError(error).message}`));
    }
  }

  private handleMessage(
    socket: WebSocket,
    message: { id?: string; reason?: string; type: string },
  ) {
    switch (message.type) {
      case 'auth_failed': {
        this.onFatal(new Error(`Gateway auth failed: ${message.reason}`));
        return;
      }
      case 'auth_success': {
        clearTimeout(this.connectTimer);
        socket.send(JSON.stringify({ lastEventId: this.gatewayCursor, type: 'resume' }));
        this.startHeartbeat(socket);
        this.onWake();
        return;
      }
      case 'heartbeat_ack': {
        this.heartbeatPending = false;
        this.retries = 0;
        return;
      }
      case 'agent_event': {
        if (message.id) this.gatewayCursor = message.id;
        this.onWake();
        return;
      }
      // Not a success signal: only a terminal event in the journal ends the run.
      case 'session_complete': {
        this.onWake();
        return;
      }
    }
  }

  private startHeartbeat(socket: WebSocket) {
    clearInterval(this.heartbeat);
    this.heartbeatPending = false;
    this.heartbeat = setInterval(() => {
      if (this.heartbeatPending) {
        this.reconnect(new Error('Agent gateway heartbeat timed out'));
        return;
      }
      this.heartbeatPending = true;
      socket.send(JSON.stringify({ type: 'heartbeat' }));
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref?.();
  }

  private reconnect(error: Error) {
    if (this.stopped || this.reconnectTimer) return;
    this.closeSocket();
    // Recover the terminal from the server even when the Gateway is down.
    this.onWake();
    if (++this.retries > this.options.maxRetries) {
      this.onFatal(
        new Error(`Reconnect attempts exhausted; complete history not confirmed: ${error.message}`),
      );
      return;
    }
    const delay = retryDelay(this.retries);
    log.debug(
      `Agent WebSocket reconnect ${this.retries}/${this.options.maxRetries} in ${delay}ms: ${error.message}`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private closeSocket() {
    clearTimeout(this.connectTimer);
    clearInterval(this.heartbeat);
    const ws = this.ws;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    this.ws = undefined;
  }
}

/**
 * WS is the wake-up channel; the authenticated server journal is authoritative.
 * This avoids mixing two unrelated cursor spaces (Gateway ids vs Redis ids),
 * live/replay races, and dependence on the Gateway's in-memory buffer.
 *
 * `done` resolves after the terminal event and rejects only with
 * `AgentStreamHistoryError`: any failure means the output may be incomplete.
 */
export const consumeAgentStream = (
  options: AgentStreamTransportOptions,
  onEvent: (event: AgentStreamEvent) => boolean,
): { close: () => void; done: Promise<void> } => {
  const resolved = { ...options, maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES };
  let stopped = false;
  let resolveDone: () => void;
  let rejectDone: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const journal = new AgentEventJournal(resolved, (event) => {
    gateway.resetRetries();
    return onEvent(event);
  });
  const catchUp = () => {
    journal.catchUp().then((terminal) => terminal && finish(), fail);
  };
  const gateway = new GatewayWakeChannel(resolved, catchUp, (error) => fail(error));
  const poll = setInterval(catchUp, HISTORY_POLL_INTERVAL_MS);

  const close = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(poll);
    journal.close();
    gateway.close();
  };
  const finish = () => {
    close();
    resolveDone();
  };
  const fail = (error: Error) => {
    if (stopped) return;
    close();
    rejectDone(
      error instanceof AgentStreamHistoryError ? error : new AgentStreamHistoryError(error.message),
    );
  };

  gateway.connect();
  return { close, done };
};
