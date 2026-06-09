// Shared types between the in-browser probe and the Node-side analyzer.
// Kept tiny on purpose — anything the analyzer can re-derive is left off.

export interface ProbeStreamEvent {
  /** Summarized payload — long strings truncated, arrays printed as Array(N) */
  data?: Record<string, unknown>;
  /** Keys present on the event's `data` payload — useful at a glance */
  dataKeys?: string[];
  /** ServerMessage.id — gateway WS frames carry an event-id we may resume from */
  eventId?: string | null;
  message?: string;
  /** Last 10 chars of the operationId (full id is excessively long) */
  opIdTail: string;
  raw?: string;
  /** Raw frame byte length, when applicable */
  rawLen?: number;
  /** For non-agent_event server frames (auth_success, heartbeat_ack, …) */
  serverType?: string;
  sseEvent?: string;
  status?: number;
  stepIndex?: number;
  /** Milliseconds since the probe's t0 (install time). */
  t: number;
  /** 'ws' for gateway WebSocket frames, 'sse' for direct /api/agent/stream */
  transport: 'ws' | 'sse';
  /** Either the AgentStreamEvent.type, or a probe sentinel like `_WS_OPEN_` */
  type: string;
  url?: string;
}

export interface ProbeActionCall {
  args?: {
    count?: number;
    context?: unknown;
    params?: unknown;
  };
  error?: string;
  /** `replaceMessages` / `refreshMessages` / `MARK:<label>` / `_WRAP_ERROR_` */
  name: string;
  stack?: string;
  t: number;
}

export interface ProbeMessageSummary {
  /** children.length */
  chN: number;
  /** content.length */
  cLen: number;
  /** Last 8 chars of the message id */
  id: string;
  /** reasoning.content.length */
  rLen: number;
  role: string;
  /** tools.length */
  tools: number;
}

export interface ProbeTimelineSample {
  /** Last 10 chars of activeTopicId, or null */
  activeTopic: string | null;
  /** Per-key breakdown: display count, db count, message summaries */
  byKey: Record<
    string,
    {
      n: number;
      dbN: number;
      msgs: ProbeMessageSummary[];
    }
  >;
  err?: string;
  /** All messagesMap keys that have content at this moment */
  keys: string[];
  /** Number of operations in 'running' status */
  runOps: number;
  t: number;
}

export interface ProbeDumpMeta {
  callCount: number;
  /** Date.now() at dump call */
  collectedAt: number;
  eventCount: number;
  sampleCount: number;
  /** Date.now() at probe install */
  t0: number;
}

export interface ProbeDump {
  actionCalls: ProbeActionCall[];
  meta: ProbeDumpMeta;
  streamEvents: ProbeStreamEvent[];
  timeline: ProbeTimelineSample[];
}

/**
 * Globals the probe attaches to `window`. Keeps `as any` casts at the boundary
 * instead of sprinkling them through the probe body.
 */
declare global {
  interface Window {
    __clickTabByKey?: (key: string) => string;
    __listTabs?: () => Array<{ i: number; key: string | null; active: boolean; title: string }>;
    __LOBE_STORES?: Record<string, () => any>;
    __PROBE_ACTION_CALLS?: ProbeActionCall[];
    __PROBE_EVENT?: (label: string) => void;
    __PROBE_MSG_TIMELINE?: ProbeTimelineSample[];
    __PROBE_ORIG_FETCH?: typeof fetch;
    __PROBE_ORIG_WEBSOCKET?: typeof WebSocket;
    __PROBE_STREAM_EVENTS?: ProbeStreamEvent[];
    __PROBE_T0?: number;
    __PROBE_TIMELINE_TIMER?: ReturnType<typeof setInterval> | null;
  }
}
