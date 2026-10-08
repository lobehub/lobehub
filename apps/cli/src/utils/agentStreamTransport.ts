import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import urlJoin from 'url-join';

import { log } from './logger';

export interface AgentHistoryPage {
  available: boolean;
  events: Array<AgentStreamEvent & { id?: string }>;
  hasMore: boolean;
  nextCursor: string;
}

export interface AgentStreamTransportOptions {
  gatewayUrl: string;
  getAuth?: () => Promise<{ serverUrl: string; token: string; tokenType: 'jwt' | 'apiKey' }>;
  maxRetries?: number;
  operationId: string;
  readHistory?: (cursor: string, signal: AbortSignal) => Promise<AgentHistoryPage>;
  serverUrl?: string;
  token: string;
  tokenType?: 'jwt' | 'apiKey';
}

/** A missing/truncated history is not a successful recovery or a retryable network outage. */
export class AgentStreamHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentStreamHistoryError';
  }
}

/**
 * WS is the wake-up channel; the authenticated server journal is authoritative.
 * This avoids mixing two unrelated cursor spaces (Gateway ids vs Redis ids),
 * live/replay races, and dependence on the Gateway's in-memory buffer.
 */
export const consumeAgentStream = (
  options: AgentStreamTransportOptions,
  onEvent: (event: AgentStreamEvent) => boolean,
  onComplete: () => void,
): { done: Promise<void>; close: () => void } => {
  let stopped = false;
  let ws: WebSocket | undefined;
  let cursor = '0';
  let gatewayCursor = '';
  let retries = 0;
  let recovering = false;
  let recoveryRequested = false;
  let recoveryFailures = 0;
  let nextRecoveryAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let connectionTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let historyTimer: ReturnType<typeof setInterval> | undefined;
  let historyRequestTimer: ReturnType<typeof setTimeout> | undefined;
  let historyAbort: AbortController | undefined;
  let heartbeatPending = false;
  let resolveDone: () => void;
  let rejectDone: (error: Error) => void;
  const seenGatewayIds = new Set<string>();
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const maxRetries = options.maxRetries ?? 6;

  const closeSocket = () => {
    clearTimeout(connectionTimer);
    clearInterval(heartbeat);
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    ws = undefined;
  };
  const close = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(reconnectTimer);
    clearInterval(historyTimer);
    clearTimeout(historyRequestTimer);
    historyAbort?.abort();
    closeSocket();
  };
  const finish = () => {
    close();
    resolveDone();
  };
  const fail = (error: Error) => {
    close();
    rejectDone(
      options.readHistory && !(error instanceof AgentStreamHistoryError)
        ? new AgentStreamHistoryError(error.message)
        : error,
    );
  };
  const retryDelay = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 15_000);

  const recover = async () => {
    if (stopped || !options.readHistory || Date.now() < nextRecoveryAt) return;
    if (recovering) {
      recoveryRequested = true;
      return;
    }
    recovering = true;
    try {
      do {
        recoveryRequested = false;
        let more = true;
        while (more && !stopped) {
          historyAbort = new AbortController();
          let page: AgentHistoryPage;
          try {
            page = await Promise.race([
              options.readHistory(cursor, historyAbort.signal),
              new Promise<never>((_, reject) => {
                historyRequestTimer = setTimeout(() => {
                  historyAbort?.abort();
                  reject(new Error('Agent history request timed out'));
                }, 10_000);
              }),
            ]);
          } finally {
            clearTimeout(historyRequestTimer);
            historyAbort = undefined;
          }
          if (stopped) return;
          if (!page.available)
            throw new AgentStreamHistoryError(
              'Agent event history expired, was trimmed, or is unavailable; complete recovery cannot be guaranteed',
            );
          for (const event of page.events) {
            if (
              !event.id ||
              !/^\d+-\d+$/.test(event.id) ||
              event.operationId !== options.operationId
            )
              throw new AgentStreamHistoryError('Invalid agent event history');
            // A retried page can overlap; compare Redis ids numerically, not lexically.
            const [time, sequence] = event.id.split('-').map(BigInt);
            const [lastTime, lastSequence = 0n] = cursor.split('-').map(BigInt);
            if (time < lastTime || (time === lastTime && sequence <= lastSequence)) continue;
            cursor = event.id;
            retries = 0;
            if (onEvent(event)) {
              finish();
              return;
            }
          }
          if (page.nextCursor !== cursor || (page.hasMore && page.events.length === 0))
            throw new AgentStreamHistoryError('Agent history cursor did not advance consistently');
          more = page.hasMore;
        }
      } while (recoveryRequested && !stopped);
      recoveryFailures = 0;
      nextRecoveryAt = 0;
    } catch (error) {
      if (stopped) return;
      const failure = error instanceof Error ? error : new Error(String(error));
      log.debug(`Agent history recovery failed: ${failure.message}`);
      // tRPC auth/not-found responses must not be retried or masked by completion.
      const code = (error as { data?: { code?: string } })?.data?.code;
      if (
        failure instanceof AgentStreamHistoryError ||
        ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].includes(code ?? '') ||
        ++recoveryFailures > maxRetries
      ) {
        fail(new AgentStreamHistoryError(`Complete history recovery failed: ${failure.message}`));
      } else {
        nextRecoveryAt = Date.now() + retryDelay(recoveryFailures);
      }
      // The periodic recovery tick retries transient HTTP failures even if the
      // Gateway never sends another notification (including a lost terminal).
    } finally {
      recovering = false;
    }
  };

  const reconnect = (error: Error) => {
    if (stopped || reconnectTimer) return;
    closeSocket();
    // Recover the terminal from the server even when the Gateway is down.
    void recover();
    if (++retries > maxRetries) {
      fail(
        options.readHistory
          ? new AgentStreamHistoryError(
              `Reconnect attempts exhausted; complete history not confirmed: ${error.message}`,
            )
          : error,
      );
      return;
    }
    const delay = retryDelay(retries);
    log.debug(`Agent WebSocket reconnect ${retries}/${maxRetries} in ${delay}ms: ${error.message}`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) return;
    const url = urlJoin(
      options.gatewayUrl.replace(/^http/, 'ws'),
      `/ws?operationId=${encodeURIComponent(options.operationId)}`,
    );
    try {
      ws = new WebSocket(url);
    } catch (error) {
      reconnect(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const socket = ws;
    connectionTimer = setTimeout(
      () => reconnect(new Error('Agent gateway connection/authentication timed out')),
      10_000,
    );
    socket.onopen = async () => {
      try {
        const auth = options.getAuth ? await options.getAuth() : options;
        if (stopped || socket !== ws) return;
        socket.send(
          JSON.stringify({
            serverUrl: auth.serverUrl,
            token: auth.token,
            tokenType: auth.tokenType ?? 'jwt',
            type: 'auth',
          }),
        );
      } catch (error) {
        fail(
          new Error(
            `Agent gateway credentials unavailable: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    };
    socket.onmessage = ({ data }) => {
      if (stopped || socket !== ws) return;
      try {
        const message = JSON.parse(String(data));
        if (message.type === 'auth_failed') {
          const reason = `Gateway auth failed: ${message.reason}`;
          fail(options.readHistory ? new AgentStreamHistoryError(reason) : new Error(reason));
          return;
        }
        if (message.type === 'auth_success') {
          clearTimeout(connectionTimer);
          heartbeatPending = false;
          socket.send(JSON.stringify({ lastEventId: gatewayCursor, type: 'resume' }));
          void recover();
          clearInterval(heartbeat);
          heartbeat = setInterval(() => {
            if (heartbeatPending) {
              reconnect(new Error('Agent gateway heartbeat timed out'));
              return;
            }
            heartbeatPending = true;
            socket.send(JSON.stringify({ type: 'heartbeat' }));
          }, 30_000);
          heartbeat.unref?.();
          return;
        }
        if (message.type === 'heartbeat_ack') {
          heartbeatPending = false;
          retries = 0;
          return;
        }
        if (message.type === 'agent_event') {
          if (message.id) gatewayCursor = message.id;
          if (options.readHistory) {
            void recover();
            return;
          }
          if (message.id && seenGatewayIds.has(message.id)) return;
          if (message.id) seenGatewayIds.add(message.id);
          if (onEvent(message.event)) finish();
        }
        if (message.type === 'session_complete') {
          if (options.readHistory) {
            void recover();
            return;
          }
          onComplete();
          finish();
        }
      } catch (error) {
        fail(
          new Error(
            `Invalid agent gateway message: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    };
    socket.onerror = () => reconnect(new Error('Agent gateway WebSocket failed'));
    socket.onclose = (event) => {
      const error = new Error(
        `Agent gateway WebSocket closed before completion (code ${event.code}${event.reason ? `: ${event.reason}` : ''})`,
      );
      if (event.code === 1008) fail(error);
      else reconnect(error);
    };
  };
  if (options.readHistory)
    historyTimer = setInterval(() => {
      void recover();
    }, 5_000);
  connect();
  return { close, done };
};
