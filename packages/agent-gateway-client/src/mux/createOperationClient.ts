import type { AgentStreamClientEvents, ConnectionStatus } from '../types';
import type { GatewayMuxClient } from './GatewayMuxClient';
import type { OperationSubscription, ResumeCompleteInfo, ToolResultPayload } from './types';

export interface OperationClientEvents extends AgentStreamClientEvents {
  resume_complete: (info: ResumeCompleteInfo) => void;
}

export interface OperationClientOptions {
  /** This tab started the run and executes its local `tool_execute` requests. */
  executor?: boolean;
  /** Last applied event id; the hub replays only newer events on subscribe. */
  lastEventId?: string;
  /**
   * Accepted for v1 option parity only. The hub orders the replay before
   * `resume_complete`, so no client-side buffering is needed.
   */
  resumeOnConnect?: boolean;
}

/**
 * Structurally compatible with the store's
 * `Pick<AgentStreamClient, 'connect' | 'disconnect' | 'on' | 'reconnect' | 'sendInterrupt' | 'sendToolResult' | 'updateToken'>`.
 */
export interface OperationClient {
  /** Subscribe this operation on the shared socket (idempotent while active). */
  connect: () => void;
  readonly connectionStatus: ConnectionStatus;
  /** Unsubscribe; emits `disconnected` like v1. */
  disconnect: () => void;
  on: <K extends keyof OperationClientEvents>(
    event: K,
    listener: OperationClientEvents[K],
  ) => () => void;
  /** Unsubscribe + resubscribe from the last applied event id. */
  reconnect: () => Promise<void>;
  sendInterrupt: () => void;
  sendToolResult: (result: ToolResultPayload) => boolean;
  /** No-op: the mux fetches a fresh token via `getToken` on every dial. */
  updateToken: (token: string) => void;
}

const FORWARDED_EVENTS: Array<keyof OperationClientEvents> = [
  'agent_event',
  'auth_expired',
  'auth_failed',
  'connected',
  'disconnected',
  'error',
  'reconnecting',
  'resume_complete',
  'session_complete',
  'status_changed',
];

type Listener = (...args: any[]) => void;

/**
 * Adapt one operation on a `GatewayMuxClient` to the v1 `AgentStreamClient`
 * surface so the store can swap transports without changing its handlers.
 */
export const createOperationClient = (
  mux: GatewayMuxClient,
  operationId: string,
  options: OperationClientOptions = {},
): OperationClient => {
  const listeners = new Map<string, Set<Listener>>();
  let subscription: OperationSubscription | null = null;
  let detach: (() => void) | null = null;
  let lastEventId = options.lastEventId ?? '';
  let status: ConnectionStatus = 'disconnected';

  const emit = (event: string, ...args: unknown[]): void => {
    const set = listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[OperationClient:${operationId}] Error in ${event} listener:`, error);
      }
    }
  };

  const bind = (sub: OperationSubscription): void => {
    const offs = FORWARDED_EVENTS.map((event) =>
      sub.on(event, ((...args: unknown[]) => {
        if (event === 'status_changed') status = args[0] as ConnectionStatus;
        emit(event, ...args);
        // A terminal signal ends the subscription; forget it so `connect()`
        // can subscribe again from the last applied event id.
        if (event === 'disconnected' && subscription === sub) {
          lastEventId = sub.lastEventId || lastEventId;
          subscription = null;
          detach = null;
        }
      }) as Listener),
    );
    detach = () => {
      for (const off of offs) off();
    };
  };

  /** Drop the live subscription without surfacing `disconnected` (v1 `reconnect()` parity). */
  const release = (): void => {
    if (!subscription) return;
    detach?.();
    lastEventId = subscription.lastEventId || lastEventId;
    const sub = subscription;
    subscription = null;
    detach = null;
    sub.unsubscribe();
  };

  const connect = (): void => {
    if (subscription?.active) return;
    const sub = mux.subscribe(operationId, {
      executor: options.executor,
      ...(lastEventId ? { lastEventId } : {}),
    });
    subscription = sub;
    bind(sub);
    // `subscribe()` already emitted its initial state before we could listen;
    // replay it so the store sees connecting → connected like v1.
    if (sub.status !== status) {
      status = sub.status;
      emit('status_changed', status);
    }
    if (sub.status === 'connected') emit('connected');
  };

  return {
    get connectionStatus() {
      return status;
    },
    connect,
    disconnect: () => {
      release();
      if (status !== 'disconnected') {
        status = 'disconnected';
        emit('status_changed', status);
      }
      emit('disconnected');
    },
    on: (event, listener) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener as Listener);
      return () => {
        set.delete(listener as Listener);
      };
    },
    reconnect: async () => {
      release();
      connect();
    },
    sendInterrupt: () => {
      subscription?.sendInterrupt();
    },
    sendToolResult: (result) => subscription?.sendToolResult(result) ?? false,
    updateToken: () => {},
  };
};
