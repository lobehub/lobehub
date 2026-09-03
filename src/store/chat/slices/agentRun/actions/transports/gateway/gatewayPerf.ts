import debug from 'debug';

const log = debug('lobe-store:gateway-perf');

/**
 * Phase 0 instrumentation for the Agent Gateway connection cost.
 *
 * Measures the serial latency chain a user feels between "send" and "first
 * streamed event" on the gateway transport:
 *
 *   exec_roundtrip   tRPC execAgentTask (fresh) / refreshGatewayToken
 *                    (reconnect) + server-side topic/message/runtime init
 *   pre_connect_gap  client-side store sync between the exec result and
 *                    connectToGateway (getMessages / switchTopic / refresh…)
 *   ws_handshake     new WebSocket → server accepted the upgrade
 *                    (TCP + TLS + WS upgrade, plus DO cold scheduling)
 *   auth_rtt         auth message → auth_success round trip (JWT verify)
 *   ttfb             connectToGateway → first agent_event
 *   total_to_ttfb    exec start → first agent_event (user-perceived dead time)
 *
 * Timers are keyed by operationId and log one summary line through the
 * `lobe-store:gateway-perf` debug namespace when the first event lands (or
 * the watchdog fires). Field data: `localStorage.debug = 'lobe-store:gateway-perf'`
 * (web) or `DEBUG=lobe-store:gateway-perf` (node/electron main).
 */

const TTFB_TIMEOUT_MS = 10 * 60 * 1000; // log a partial summary after 10 min without an event
const ORPHAN_TIMEOUT_MS = 30_000; // exec returned but connect never started → drop
const MAX_CONCURRENT = 20; // cap memory; beyond this we instrument nothing

export interface GatewayPerfPhases {
  /** auth message → auth_success round trip. */
  auth_rtt?: number;
  /** tRPC exec/refresh round trip. */
  exec_roundtrip?: number;
  /** store-sync awaits between exec result and WS connect. */
  pre_connect_gap?: number;
  /** connectToGateway → first agent event. */
  ttfb?: number;
  /** new WebSocket → upgrade accepted (status 'authenticating'). */
  ws_handshake?: number;
}

export interface GatewayPerfContext {
  /** Whether this run re-attached to an existing op (useGatewayReconnect). */
  reconnect: boolean;
}

interface ActiveTimer {
  context: GatewayPerfContext;
  marks: Partial<{
    authEnd: number;
    connectStart: number;
    execEnd: number;
    execStart: number;
    firstEventAt: number;
    handshakeEnd: number;
  }>;
  orphanTimeout: ReturnType<typeof setTimeout> | null;
  phases: GatewayPerfPhases;
  ttfbTimeout: ReturnType<typeof setTimeout> | null;
}

const active = new Map<string, ActiveTimer>();

/**
 * Build the summary line. Exported for testing only.
 */
export const formatGatewayPerfSummary = (
  operationId: string,
  phases: GatewayPerfPhases,
  context: GatewayPerfContext,
): string => {
  const parts: string[] = [];

  const append = (label: string, value?: number) => {
    parts.push(`${label}=${value !== undefined ? `${value}ms` : 'n/a'}`);
  };

  append('exec', phases.exec_roundtrip);
  append('gap', phases.pre_connect_gap);
  append('handshake', phases.ws_handshake);
  append('auth', phases.auth_rtt);
  append('ttfb', phases.ttfb);

  return `gateway-perf op=${operationId} ${parts.join(' ')} mode=${context.reconnect ? 'reconnect' : 'fresh'}`;
};

const clearTimers = (timer: ActiveTimer) => {
  if (timer.ttfbTimeout) clearTimeout(timer.ttfbTimeout);
  if (timer.orphanTimeout) clearTimeout(timer.orphanTimeout);
};

const maybeLogSummary = (operationId: string, timer: ActiveTimer) => {
  const { marks } = timer;
  // Summary needs the absolute bookends: exec start → first event. Phases in
  // between stay silent until then, keeping the output one-line-per-run.
  if (marks.execStart === undefined || marks.firstEventAt === undefined) return;

  const phases = {
    ...timer.phases,
    ttfb: marks.firstEventAt - (marks.connectStart ?? marks.execStart),
  };
  const total = marks.firstEventAt - marks.execStart;
  log(
    '%s',
    `${formatGatewayPerfSummary(operationId, phases, timer.context)} total_to_ttfb=${total}ms`,
  );
};

// ─── Public instrumentation API (called from gateway.ts) ───

/**
 * A fresh run's exec round trip returned. `execStartedAt` is the timestamp
 * captured just before the tRPC call; pass `null` when the result was
 * precreated (exec happened elsewhere — no exec_roundtrip is recorded).
 */
export const gatewayPerfFreshRun = (operationId: string, execStartedAt: number | null): void => {
  if (active.has(operationId)) return; // reconnect raced with fresh run — first wins
  if (active.size >= MAX_CONCURRENT) return;

  const now = Date.now();
  const timer: ActiveTimer = {
    context: { reconnect: false },
    marks: execStartedAt === null ? {} : { execEnd: now, execStart: execStartedAt },
    orphanTimeout: null,
    phases: execStartedAt === null ? {} : { exec_roundtrip: now - execStartedAt },
    ttfbTimeout: null,
  };
  active.set(operationId, timer);

  // If connectToGateway never runs (post-exec throw / cancel), drop silently.
  timer.orphanTimeout = setTimeout(() => {
    const t = active.get(operationId);
    if (t && t.marks.connectStart === undefined) active.delete(operationId);
  }, ORPHAN_TIMEOUT_MS);
};

/**
 * A reconnect's token refresh returned. Same as {@link gatewayPerfFreshRun}
 * with the reconnect mode flag set.
 */
export const gatewayPerfReconnect = (operationId: string, refreshStartedAt: number): void => {
  if (active.has(operationId)) return; // fresh run owns this op — don't clobber
  if (active.size >= MAX_CONCURRENT) return;

  const now = Date.now();
  const timer: ActiveTimer = {
    context: { reconnect: true },
    marks: { execEnd: now, execStart: refreshStartedAt },
    orphanTimeout: null,
    phases: { exec_roundtrip: now - refreshStartedAt },
    ttfbTimeout: null,
  };
  active.set(operationId, timer);

  timer.orphanTimeout = setTimeout(() => {
    const t = active.get(operationId);
    if (t && t.marks.connectStart === undefined) active.delete(operationId);
  }, ORPHAN_TIMEOUT_MS);
};

/**
 * Mark connectToGateway: WS connect begins from this instant; the gap since
 * the exec result becomes pre_connect_gap.
 */
export const gatewayPerfConnectStart = (operationId: string): void => {
  const timer = active.get(operationId);
  if (!timer || timer.marks.connectStart !== undefined) return;
  const now = Date.now();
  timer.marks.connectStart = now;
  if (timer.orphanTimeout) {
    clearTimeout(timer.orphanTimeout);
    timer.orphanTimeout = null;
  }
  if (timer.marks.execEnd !== undefined) {
    timer.phases.pre_connect_gap = now - timer.marks.execEnd;
  }

  // Watchdog: if no event ever arrives (dead DO, auth never completes), log
  // what we have so the run still shows up in field data, then stop tracking.
  timer.ttfbTimeout = setTimeout(() => {
    const t = active.get(operationId);
    if (!t || t.marks.firstEventAt !== undefined) return;
    t.marks.firstEventAt = Date.now();
    maybeLogSummary(operationId, t);
    active.delete(operationId);
  }, TTFB_TIMEOUT_MS);
};

/**
 * Observe a connection-status transition from the AgentStreamClient:
 *   connecting → authenticating  ⇒ ws_handshake done
 *   authenticating → connected   ⇒ auth_rtt done
 */
export const gatewayPerfStatusChanged = (operationId: string, status: string): void => {
  const timer = active.get(operationId);
  if (!timer) return;
  const now = Date.now();

  if (status === 'authenticating' && timer.marks.handshakeEnd === undefined) {
    timer.marks.handshakeEnd = now;
    if (timer.marks.connectStart !== undefined) {
      timer.phases.ws_handshake = now - timer.marks.connectStart;
    }
  }
  if (status === 'connected' && timer.marks.authEnd === undefined) {
    timer.marks.authEnd = now;
    if (timer.marks.handshakeEnd !== undefined) {
      timer.phases.auth_rtt = now - timer.marks.handshakeEnd;
    }
  }
};

/**
 * Mark the first agent event. Emits the summary line and stops tracking.
 */
export const gatewayPerfFirstEvent = (operationId: string): void => {
  const timer = active.get(operationId);
  if (!timer || timer.marks.firstEventAt !== undefined) return;
  timer.marks.firstEventAt = Date.now();
  if (timer.ttfbTimeout) {
    clearTimeout(timer.ttfbTimeout);
    timer.ttfbTimeout = null;
  }
  maybeLogSummary(operationId, timer);
  active.delete(operationId);
};

/**
 * Drop a timer without logging (op cancelled / superseded before any event).
 */
export const gatewayPerfAbort = (operationId: string): void => {
  const timer = active.get(operationId);
  if (!timer) return;
  clearTimers(timer);
  active.delete(operationId);
};

// Test-only helper: reset module state between tests.
export const gatewayPerfReset = (): void => {
  for (const [, timer] of active) {
    clearTimers(timer);
  }
  active.clear();
};
