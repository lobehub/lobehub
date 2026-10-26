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
  /**
   * Stream events the Gateway delivers for another operation on this socket — a
   * group member's events mirrored onto the supervisor's channel.
   *
   * Server-side they are appended to the journal under the *member's* operation,
   * so `readHistory(this.operationId)` can never replay them: this wire is their
   * only source for a CLI run of a group/supervisor agent. They are therefore
   * delivered here instead of being reduced to a wake-up, and never as terminal
   * events — a member finishing must not end the supervisor's stream.
   */
  onMirroredEvent?: (event: AgentStreamEvent) => void;
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

/**
 * The server has no event journal endpoint: the independently released CLI is
 * newer than the server it talks to. This is a compatibility gap, not a lost
 * history, so it must reach the caller untouched — the caller degrades to
 * status polling instead of reporting an unconfirmable outcome.
 */
export class AgentJournalUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentJournalUnsupportedError';
  }
}

/**
 * The Gateway is unusable for this run — it stayed unreachable through the whole
 * reconnect budget, or it rejected the CLI's credentials. This is a connectivity
 * outage, not a lost history: the journal may still be intact and the run may
 * still be executing, so it must reach the caller untouched — the caller
 * degrades to status polling instead of reporting an unconfirmable run.
 */
export class AgentGatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentGatewayUnavailableError';
  }
}

const DEFAULT_MAX_RETRIES = 6;
const CONNECT_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HISTORY_POLL_INTERVAL_MS = 5000;
const HISTORY_REQUEST_TIMEOUT_MS = 10_000;
/**
 * Chunk notifications are buffered server-side every ~300ms, so one CLI run can
 * publish roughly three `agent_event` frames per second. Each wake costs an
 * authenticated round trip (visibility query + Redis XRANGE), so chunk wakes are
 * coalesced into at most one read per window. Terminal-ish wakes bypass it.
 */
const WAKE_COALESCE_WINDOW_MS = 500;
/** Gateway frame ids remembered so a resume replay cannot re-render a member event. */
const MIRRORED_ID_MEMORY = 200;
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
      // A server without the journal procedure cannot be retried into having it.
      if (failure instanceof AgentJournalUnsupportedError) throw failure;
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
  private mirroredIds = new Set<string>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private retries = 0;
  private stopped = false;
  private ws?: WebSocket;

  constructor(
    private readonly options: AgentStreamTransportOptions & { maxRetries: number },
    /** `immediate` skips the coalescing window (terminal / reconnect wakes). */
    private readonly onWake: (immediate?: boolean) => void,
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
      // A credential that cannot be resolved right now is a Gateway problem,
      // not an unconfirmable history: the stored access token may still work
      // for the journal and the status endpoint, so the caller keeps its
      // polling fallback instead of reporting an `unknown` outcome.
      this.onFatal(
        new AgentGatewayUnavailableError(
          `Agent gateway credentials unavailable: ${toError(error).message}`,
        ),
      );
    }
  }

  private handleMessage(
    socket: WebSocket,
    message: { event?: AgentStreamEvent; id?: string; reason?: string; type: string },
  ) {
    switch (message.type) {
      case 'auth_failed': {
        // The server API accepted this credential but the Gateway did not — e.g.
        // a self-hosted server paired with the wrong Gateway. Retrying cannot
        // help, yet the journal and the status endpoint are still reachable, so
        // this is a Gateway failure rather than an unconfirmable history: the
        // caller must be able to fall back to polling instead of reporting an
        // `unknown` run. This usually lands before the first journal read, so
        // misclassifying it fails a healthy run with exit code 3 and no output.
        this.onFatal(new AgentGatewayUnavailableError(`Gateway auth failed: ${message.reason}`));
        return;
      }
      case 'auth_success': {
        clearTimeout(this.connectTimer);
        socket.send(JSON.stringify({ lastEventId: this.gatewayCursor, type: 'resume' }));
        this.startHeartbeat(socket);
        this.onWake(true);
        return;
      }
      case 'heartbeat_ack': {
        this.heartbeatPending = false;
        this.retries = 0;
        return;
      }
      case 'agent_event': {
        if (message.id) this.gatewayCursor = message.id;
        this.deliverMirrored(message);
        this.onWake();
        return;
      }
      // Not a success signal: only a terminal event in the journal ends the run.
      // The terminal is imminent, so this wake skips the coalescing window.
      case 'session_complete': {
        this.onWake(true);
        return;
      }
    }
  }

  /**
   * A group member's events are delivered on the supervisor's socket, but their
   * journal entries stay under the member's own operation id — so no read of the
   * supervisor's history can replay them. This wire is their only source, hence
   * they are handed to the consumer instead of only waking the journal.
   *
   * Delivered non-terminal by contract: the server renames a mirrored member
   * terminal to `member_runtime_end` precisely so the supervisor keeps running.
   */
  private deliverMirrored(message: { event?: AgentStreamEvent; id?: string }) {
    const mirrored = message.event;
    const deliver = this.options.onMirroredEvent;
    if (!deliver || !mirrored?.operationId) return;
    // Legacy gateways omit `operationId`; those events are this op's, and the
    // journal already covers them.
    if (mirrored.operationId === this.options.operationId) return;
    // A reconnect resumes from `gatewayCursor`, so the same mirrored frame can
    // legitimately arrive twice.
    if (message.id) {
      if (this.mirroredIds.has(message.id)) return;
      if (this.mirroredIds.size >= MIRRORED_ID_MEMORY)
        this.mirroredIds.delete(this.mirroredIds.values().next().value!);
      this.mirroredIds.add(message.id);
    }
    deliver(mirrored);
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
    this.onWake(true);
    if (++this.retries > this.options.maxRetries) {
      this.onFatal(
        new AgentGatewayUnavailableError(
          `Reconnect attempts exhausted; complete history not confirmed: ${error.message}`,
        ),
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
 * `done` resolves after the terminal event and rejects with
 * `AgentStreamHistoryError` when the output may be incomplete, with
 * `AgentGatewayUnavailableError` when the Gateway never came back (the run may
 * still be healthy, so the caller can fall back to polling), or with
 * `AgentJournalUnsupportedError` when the server has no journal to read at all.
 * `abort` lets the consumer end the stream as incomplete (e.g. a stall check).
 */
export const consumeAgentStream = (
  options: AgentStreamTransportOptions,
  onEvent: (event: AgentStreamEvent) => boolean,
): {
  abort: (error: Error) => void;
  /** Reads the journal now; resolves `true` once a terminal event was delivered. */
  catchUp: () => Promise<boolean>;
  close: () => void;
  done: Promise<void>;
} => {
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
  // A catch-up pass is started without awaiting it, so a mirrored member frame
  // arriving mid-read would print ahead of supervisor history the server had
  // already published — an out-of-order transcript, most likely on resume, when
  // buffered member frames land while the first read is still pending. Hold
  // mirrored deliveries behind every in-flight pass, keeping their own order.
  let catchUpDepth = 0;
  const queuedMirrored: AgentStreamEvent[] = [];
  const emitMirrored = (event: AgentStreamEvent) => {
    try {
      resolved.onMirroredEvent?.(event);
    } catch (error) {
      fail(toError(error));
    }
  };
  const deliverMirrored = (event: AgentStreamEvent) => {
    if (stopped) return;
    // Queued rather than chained on the pass promise: a terminal pass closes the
    // transport from inside that same promise, so a chained continuation would
    // observe `stopped` and drop member output.
    if (catchUpDepth > 0) {
      queuedMirrored.push(event);
      return;
    }
    emitMirrored(event);
  };
  const flushMirrored = () => {
    while (queuedMirrored.length > 0 && !stopped) emitMirrored(queuedMirrored.shift()!);
  };

  const runCatchUp = (): Promise<boolean> => {
    const pass = (async () => {
      catchUpDepth += 1;
      try {
        const terminal = await journal.catchUp();
        if (terminal) {
          // Mirrored frames queued behind this read belong to the transcript the
          // run is about to report as complete: drain them before `finish()`
          // flips `stopped`, or a fast group run silently loses member output.
          flushMirrored();
          finish();
        }
        return terminal;
      } catch (error) {
        fail(error as Error);
        return false;
      } finally {
        catchUpDepth -= 1;
        // Only the last pass may drain: a pass that returns immediately because
        // the journal is already reading must not release frames queued behind
        // the read that is actually in flight.
        if (catchUpDepth === 0) flushMirrored();
      }
    })();
    return pass;
  };
  // Chunk wakes are coalesced: the first one reads immediately and opens a
  // window, further chunks inside it collapse into a single trailing read.
  // Terminal and reconnect wakes read immediately and reset the window.
  let wakePending = false;
  let wakeWindow: ReturnType<typeof setTimeout> | undefined;
  const wake = (immediate = false) => {
    if (stopped) return;
    if (immediate) {
      clearTimeout(wakeWindow);
      wakeWindow = undefined;
      wakePending = false;
      void runCatchUp();
      return;
    }
    if (wakeWindow) {
      wakePending = true;
      return;
    }
    void runCatchUp();
    wakeWindow = setTimeout(() => {
      wakeWindow = undefined;
      if (!wakePending) return;
      wakePending = false;
      wake();
    }, WAKE_COALESCE_WINDOW_MS);
  };
  const gateway = new GatewayWakeChannel(
    { ...resolved, onMirroredEvent: resolved.onMirroredEvent ? deliverMirrored : undefined },
    wake,
    (error) => fail(error),
  );
  const poll = setInterval(() => void runCatchUp(), HISTORY_POLL_INTERVAL_MS);

  const close = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(poll);
    clearTimeout(wakeWindow);
    wakeWindow = undefined;
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
      error instanceof AgentStreamHistoryError ||
        error instanceof AgentJournalUnsupportedError ||
        error instanceof AgentGatewayUnavailableError
        ? error
        : new AgentStreamHistoryError(error.message),
    );
  };

  gateway.connect();
  return { abort: fail, catchUp: runCatchUp, close, done };
};
