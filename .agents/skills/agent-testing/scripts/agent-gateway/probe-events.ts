// LobeHub gateway raw-event-stream probe.
//
// Gateway-mode chats subscribe via WebSocket — NOT via the `/api/agent/stream`
// SSE endpoint (that one belongs to the direct/client durable-agent runtime).
// `AgentStreamClient` (`packages/agent-gateway-client/src/client.ts`) opens
// `new WebSocket('wss://.../ws?operationId=...')`, then parses JSON frames in
// its `onmessage` handler and re-emits `agent_event.event` objects to the
// chat store.
//
// To capture the RAW gateway events before the store touches them, we wrap
// `window.WebSocket` so that for any socket whose URL contains `operationId=`
// we intercept the `onmessage` handler / `addEventListener('message')` and
// log every `agent_event` frame.
//
// We *also* keep the `window.fetch` hook for `/api/agent/stream` so this
// probe still works for direct-mode runs — but gateway-mode events come
// through the WebSocket path.
//
// Buffers (read via `dump`):
//   __PROBE_STREAM_EVENTS  — raw events parsed off the wire
//   __PROBE_ACTION_CALLS   — replaceMessages / refreshMessages calls (best-effort)
//   __PROBE_MSG_TIMELINE   — 200ms snapshots of every messagesMap key

import type {
  ProbeActionCall,
  ProbeMessageSummary,
  ProbeStreamEvent,
  ProbeTimelineSample,
} from './types';

// Bundled by esbuild as an IIFE. Top-level code runs once on injection.

const w = window;

// ── Buffers ─────────────────────────────────────────────────────────

declare global {
  interface Window {
    __PROBE_MUTATIONS?: Array<{
      t: number;
      key: string;
      n: number;
      last?: { id: string; role: string; cLen: number; rLen: number; updatedAt?: unknown };
      prevLast?: { id: string; role: string; cLen: number; rLen: number };
      delta?: string;
    }>;
    __PROBE_STORE_UNSUB?: () => void;
  }
}

const events: ProbeStreamEvent[] = (w.__PROBE_STREAM_EVENTS ??= []);
const calls: ProbeActionCall[] = (w.__PROBE_ACTION_CALLS ??= []);
const timeline: ProbeTimelineSample[] = (w.__PROBE_MSG_TIMELINE ??= []);
const mutations = (w.__PROBE_MUTATIONS ??= []);
events.length = 0;
calls.length = 0;
timeline.length = 0;
mutations.length = 0;

const t0 = Date.now();
w.__PROBE_T0 = t0;
const now = (): number => Date.now() - t0;

// ── Helpers ─────────────────────────────────────────────────────────

function summarizeData(data: unknown): Record<string, unknown> | unknown {
  if (!data || typeof data !== 'object') return data;
  const src = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v == null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = `Array(${v.length})`;
      if (k === 'uiMessages') {
        out.uiMessagesPreview = v.slice(0, 5).map((m: any) => ({
          id: (m.id ?? '').slice(-8),
          role: m.role,
          cLen: (m.content ?? '').length,
          children: (m.children ?? []).length,
          tools: (m.tools ?? []).length,
          reasoning: (m.reasoning?.content ?? '').length,
        }));
        out.uiMessagesTotal = v.length;
      }
    } else if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      out[k] =
        'Object{' +
        Object.keys(obj)
          .slice(0, 6)
          .map((kk) => kk + (typeof obj[kk] === 'string' ? `=${(obj[kk] as string).length}ch` : ''))
          .join(',') +
        '}';
    } else if (typeof v === 'string') {
      out[k] = v.length > 100 ? v.slice(0, 100) + `…(${v.length})` : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function summarizeMessages(msgs: any[]): ProbeMessageSummary[] {
  return (msgs ?? []).slice(0, 80).map((m) => ({
    id: (m.id ?? '').slice(-8),
    role: m.role,
    cLen: (m.content ?? '').length,
    rLen: (m.reasoning?.content ?? '').length,
    tools: (m.tools ?? []).length,
    chN: (m.children ?? []).length,
  }));
}

function shortStack(): string {
  const raw = new Error('probe-stack').stack ?? '';
  return raw
    .split('\n')
    .slice(3)
    .filter((l) => !l.includes('probe-events') && !l.includes('node_modules'))
    .map((l) => l.trim().replace(/^at\s+/, ''))
    .slice(0, 6)
    .join(' ← ');
}

function recordAgentEvent(args: {
  transport: 'ws' | 'sse';
  opId: string | null;
  agentEvent: any;
  eventId?: string | null;
  rawLen?: number;
}): void {
  const { transport, opId, agentEvent, eventId, rawLen } = args;
  if (!agentEvent || typeof agentEvent !== 'object') return;
  events.push({
    t: now(),
    transport,
    opIdTail: (opId ?? '').slice(-10),
    eventId: eventId ?? null,
    type: agentEvent.type,
    stepIndex: agentEvent.stepIndex,
    dataKeys: agentEvent.data ? Object.keys(agentEvent.data) : [],
    data: summarizeData(agentEvent.data) as Record<string, unknown>,
    rawLen,
  });
}

// ── 1. Patch window.WebSocket for gateway WS events ────────────────

if (!w.__PROBE_ORIG_WEBSOCKET) w.__PROBE_ORIG_WEBSOCKET = w.WebSocket;
const OrigWS = w.__PROBE_ORIG_WEBSOCKET;

function extractOpIdFromWsUrl(url: string | URL): string | null {
  const m = String(url ?? '').match(/operationId=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function isGatewayWs(url: string | URL): boolean {
  return String(url ?? '').includes('operationId=');
}

function handleWsFrame(rawData: unknown, opId: string | null): void {
  const rawLen = typeof rawData === 'string' ? rawData.length : -1;
  let parsed: any;
  try {
    parsed = typeof rawData === 'string' ? JSON.parse(rawData) : null;
  } catch {
    events.push({
      t: now(),
      transport: 'ws',
      opIdTail: (opId ?? '').slice(-10),
      type: '_PARSE_ERROR_',
      raw: typeof rawData === 'string' && rawData.length < 400 ? rawData : '(non-string or large)',
    });
    return;
  }
  if (!parsed) return;

  if (parsed.type === 'agent_event') {
    recordAgentEvent({
      transport: 'ws',
      opId,
      agentEvent: parsed.event,
      eventId: parsed.id,
      rawLen,
    });
  } else {
    events.push({
      t: now(),
      transport: 'ws',
      opIdTail: (opId ?? '').slice(-10),
      type: '_SERVER_MSG_',
      serverType: parsed.type,
      rawLen,
    });
  }
}

// Wrap the constructor. Instance `constructor` will still reflect OrigWS
// (we share prototypes), so use the `_WS_OPEN_` sentinel events to confirm
// the patch is firing.
function PatchedWebSocket(this: WebSocket, url: string | URL, protocols?: string | string[]) {
  const ws: WebSocket = protocols == null ? new OrigWS(url) : new OrigWS(url, protocols);
  const opId = extractOpIdFromWsUrl(url);
  if (!isGatewayWs(url)) return ws;

  events.push({
    t: now(),
    transport: 'ws',
    opIdTail: (opId ?? '').slice(-10),
    type: '_WS_OPEN_',
    url: String(url),
  });

  // One observer listener that always fires, regardless of how the consumer
  // (AgentStreamClient uses `ws.onmessage = …`) subscribes.
  ws.addEventListener('message', (e) => {
    try {
      handleWsFrame((e as MessageEvent).data, opId);
    } catch {
      /* swallow */
    }
  });

  ws.addEventListener('close', () => {
    events.push({
      t: now(),
      transport: 'ws',
      opIdTail: (opId ?? '').slice(-10),
      type: '_WS_CLOSE_',
    });
  });

  return ws;
}

// Preserve prototype + static fields so `instanceof WebSocket` and
// `WebSocket.OPEN` constants still work.
(PatchedWebSocket as unknown as { prototype: WebSocket }).prototype = OrigWS.prototype;
for (const k of Object.keys(OrigWS) as Array<keyof typeof OrigWS>) {
  try {
    (PatchedWebSocket as any)[k] = (OrigWS as any)[k];
  } catch {
    /* readonly */
  }
}
(['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const).forEach((k) => {
  (PatchedWebSocket as any)[k] = (OrigWS as any)[k];
});
w.WebSocket = PatchedWebSocket as unknown as typeof WebSocket;

// ── 2. Patch window.fetch for `/api/agent/stream` (direct-mode SSE) ─

if (!w.__PROBE_ORIG_FETCH) w.__PROBE_ORIG_FETCH = w.fetch.bind(w);
const origFetch = w.__PROBE_ORIG_FETCH;

function isAgentStreamUrl(input: RequestInfo | URL): boolean {
  let url = '';
  if (typeof input === 'string') url = input;
  else if (input instanceof URL) url = input.toString();
  else if (input && typeof (input as Request).url === 'string') url = (input as Request).url;
  return url.includes('/api/agent/stream');
}

function extractOpIdFromHttpUrl(input: RequestInfo | URL): string | null {
  const url = typeof input === 'string' ? input : (input as Request | URL).toString();
  const m = url.match(/operationId=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function pushFromSSEFrame(rawFrame: string, opId: string | null): void {
  const lines = rawFrame.split('\n');
  let dataJson = '';
  let evtName = 'message';
  for (const line of lines) {
    if (line.startsWith('event:')) evtName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataJson += line.slice(5).trim();
  }
  if (!dataJson) return;
  let parsed: any;
  try {
    parsed = JSON.parse(dataJson);
  } catch {
    events.push({
      t: now(),
      transport: 'sse',
      opIdTail: (opId ?? '').slice(-10),
      type: '_PARSE_ERROR_',
      sseEvent: evtName,
      raw: dataJson.length > 400 ? dataJson.slice(0, 400) + '…' : dataJson,
    });
    return;
  }
  recordAgentEvent({
    transport: 'sse',
    opId,
    agentEvent: parsed,
    eventId: null,
    rawLen: dataJson.length,
  });
}

async function teeAndDrain(response: Response, opId: string | null): Promise<Response> {
  if (!response.body) return response;
  const [a, b] = response.body.tee();

  void (async () => {
    const reader = b.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;

        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (frame.trim()) pushFromSSEFrame(frame, opId);
        }
      }
      if (buf.trim()) pushFromSSEFrame(buf, opId);
    } catch (e: any) {
      events.push({
        t: now(),
        transport: 'sse',
        opIdTail: (opId ?? '').slice(-10),
        type: '_TEE_ERROR_',
        message: String(e?.message ?? e),
      });
    }
  })();

  return new Response(a, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

w.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await origFetch(input as any, init);
  if (!isAgentStreamUrl(input)) return response;
  const opId = extractOpIdFromHttpUrl(input);
  const url =
    typeof input === 'string'
      ? input.split('?')[0]
      : (input as Request | URL).toString().split('?')[0];
  events.push({
    t: now(),
    transport: 'sse',
    opIdTail: (opId ?? '').slice(-10),
    type: '_CONNECTED_',
    url,
    status: response.status,
  });
  return teeAndDrain(response, opId);
} as typeof fetch;

// ── 3. Wrap store actions (best-effort for "who called replace") ────

// Side-global stash for the original chat-store actions. Re-installs ALWAYS
// rewrap from the originals so updates to the probe body take effect
// without a page reload — using only a `__probeWrapped` flag on the chat
// state object would freeze the first-installed wrapper across re-installs.
declare global {
  interface Window {
    __PROBE_ORIG_REFRESH_MESSAGES?: any;
    __PROBE_ORIG_REPLACE_MESSAGES?: any;
  }
}

try {
  const chat = w.__LOBE_STORES?.chat?.();
  if (chat) {
    // First-time install: cache the originals. Re-install: restore from
    // the cached originals before wrapping again.
    if (!w.__PROBE_ORIG_REFRESH_MESSAGES) w.__PROBE_ORIG_REFRESH_MESSAGES = chat.refreshMessages;
    if (!w.__PROBE_ORIG_REPLACE_MESSAGES) w.__PROBE_ORIG_REPLACE_MESSAGES = chat.replaceMessages;
    const origRefresh = w.__PROBE_ORIG_REFRESH_MESSAGES;
    const origReplace = w.__PROBE_ORIG_REPLACE_MESSAGES;
    chat.refreshMessages = origRefresh;
    chat.replaceMessages = origReplace;

    chat.refreshMessages = async function probeRefresh(this: unknown, ...args: any[]) {
      calls.push({
        t: now(),
        name: 'refreshMessages',
        args: { context: args[0] ?? null },
        stack: shortStack(),
      });
      return origRefresh.apply(this, args);
    };
    chat.replaceMessages = function probeReplace(this: unknown, ...args: any[]) {
      const msgs = (args[0] as any[]) ?? [];
      const snapshot = msgs.slice(-2).map((m) => ({
        id: (m.id ?? '').slice(-8),
        role: m.role,
        cLen: (m.content ?? '').length,
        rLen: (m.reasoning?.content ?? '').length,
        updatedAt: m.updatedAt,
      }));
      calls.push({
        t: now(),
        name: 'replaceMessages',
        args: { count: msgs.length, params: args[1] ?? null, snapshot } as any,
        stack: shortStack(),
      });

      // Pair the call with a mutation row so the analyzer can build a
      // single ordered timeline across replaceMessages + dispatchMessage.
      const stackTop = shortStack().split(' ← ')[0]?.slice(0, 80);
      const last = msgs.at(-1);
      const lastSum = last
        ? {
            id: (last.id ?? '').slice(-8),
            role: last.role,
            cLen: (last.content ?? '').length,
            rLen: (last.reasoning?.content ?? '').length,
            updatedAt: last.updatedAt,
          }
        : undefined;
      const params: any = args[1] ?? {};
      const ctxKey = params.context
        ? `main_${params.context.agentId ?? '?'}_${
            params.context.topicId ? 'tpc_' + params.context.topicId : 'new'
          }`.replace('main_tpc_', 'main_') // crude key inference
        : '(no-ctx)';
      mutations.push({
        t: now(),
        key: ctxKey,
        n: msgs.length,
        last: lastSum,
        delta: `replaceMessages(action=${params.action ?? '-'})  src=${stackTop ?? '-'}`,
      });

      return origReplace.apply(this, args);
    };
  }
} catch (e: any) {
  calls.push({ t: now(), name: '_WRAP_ERROR_', error: String(e?.message ?? e) });
}

// ── 3.5. Mutation log — wrap the TWO ChatStore writers (replaceMessages,
// internal_dispatchMessage) to record EVERY dbMessagesMap[key] reference
// change with a one-line "before/after last assistant message" delta. This
// reveals dispatchMessage-driven collapses that the replaceMessages wrap
// alone cannot see.

declare global {
  interface Window {
    __PROBE_ORIG_DISPATCH_MESSAGE?: any;
  }
}

try {
  const chat = w.__LOBE_STORES?.chat?.();
  if (chat?.internal_dispatchMessage) {
    if (!w.__PROBE_ORIG_DISPATCH_MESSAGE)
      w.__PROBE_ORIG_DISPATCH_MESSAGE = chat.internal_dispatchMessage;
    const origDispatch = w.__PROBE_ORIG_DISPATCH_MESSAGE;
    chat.internal_dispatchMessage = origDispatch;

    chat.internal_dispatchMessage = function probeDispatch(this: unknown, payload: any, ctx?: any) {
      // Snapshot BEFORE — read the would-be target key + last message.
      const before = (() => {
        try {
          const state = w.__LOBE_STORES?.chat?.();
          if (!state) return null;
          // Replicate state.internal_getConversationContext logic enough to
          // resolve a key — but most callers pass operationId on ctx, and
          // operationId-keyed lookup needs store internals. Easiest: snapshot
          // ALL keys' last-assistant cLen and compare BEFORE vs AFTER below.
          const map = state.dbMessagesMap ?? {};
          const out: Record<string, any> = {};
          for (const k of Object.keys(map)) {
            const last = (map[k] ?? []).at(-1);
            out[k] = last
              ? {
                  id: (last.id ?? '').slice(-8),
                  cLen: (last.content ?? '').length,
                  rLen: (last.reasoning?.content ?? '').length,
                  n: map[k].length,
                }
              : { n: 0 };
          }
          return out;
        } catch {
          return null;
        }
      })();

      const result = origDispatch.apply(this, [payload, ctx]);

      // Snapshot AFTER — find which key(s) actually changed.
      try {
        const state = w.__LOBE_STORES?.chat?.();
        if (state && before) {
          const map = state.dbMessagesMap ?? {};
          for (const k of Object.keys(map)) {
            const last = (map[k] ?? []).at(-1);
            const beforeSnap = before[k];
            const afterSnap = last
              ? {
                  id: (last.id ?? '').slice(-8),
                  cLen: (last.content ?? '').length,
                  rLen: (last.reasoning?.content ?? '').length,
                  n: map[k].length,
                }
              : { n: 0 };
            const changed =
              !beforeSnap ||
              beforeSnap.n !== afterSnap.n ||
              beforeSnap.id !== (afterSnap as any).id ||
              beforeSnap.cLen !== (afterSnap as any).cLen ||
              beforeSnap.rLen !== (afterSnap as any).rLen;
            if (!changed) continue;
            let delta = '';
            if (beforeSnap?.id !== undefined && beforeSnap.id !== (afterSnap as any).id)
              delta += `id:${beforeSnap.id}→${(afterSnap as any).id};`;
            if (
              beforeSnap?.cLen !== undefined &&
              (afterSnap as any).cLen !== undefined &&
              (afterSnap as any).cLen < beforeSnap.cLen
            )
              delta += `cLen↓${beforeSnap.cLen}→${(afterSnap as any).cLen};`;
            if (
              beforeSnap?.rLen !== undefined &&
              (afterSnap as any).rLen !== undefined &&
              (afterSnap as any).rLen < beforeSnap.rLen
            )
              delta += `rLen↓${beforeSnap.rLen}→${(afterSnap as any).rLen};`;
            if (beforeSnap?.n !== undefined && afterSnap.n < beforeSnap.n)
              delta += `n↓${beforeSnap.n}→${afterSnap.n};`;
            mutations.push({
              t: now(),
              key: k,
              n: afterSnap.n,
              last: (afterSnap as any).id ? (afterSnap as any) : undefined,
              prevLast: beforeSnap?.id ? beforeSnap : undefined,
              delta: delta || `dispatch:${payload?.type}`,
            });
          }
        }
      } catch (e: any) {
        mutations.push({
          t: now(),
          key: '_DISPATCH_PROBE_ERROR_',
          n: -1,
          delta: String(e?.message ?? e),
        });
      }
      return result;
    };
  }
} catch (e: any) {
  calls.push({ t: now(), name: '_DISPATCH_WRAP_ERROR_', error: String(e?.message ?? e) });
}

// ── 4. Periodic per-key timeline snapshots ─────────────────────────

function captureTimeline(): void {
  try {
    const c = w.__LOBE_STORES?.chat?.();
    if (!c) return;
    const msgsMap = (c.messagesMap ?? {}) as Record<string, any[]>;
    const dbMap = (c.dbMessagesMap ?? {}) as Record<string, any[]>;
    const byKey: ProbeTimelineSample['byKey'] = {};
    for (const k of Object.keys(msgsMap)) {
      const display = msgsMap[k] ?? [];
      const db = dbMap[k] ?? [];
      if (display.length === 0 && db.length === 0) continue;
      byKey[k] = {
        n: display.length,
        dbN: db.length,
        msgs: summarizeMessages(display),
      };
    }
    const ops = Object.values((c.operations ?? {}) as Record<string, any>);
    timeline.push({
      t: now(),
      activeTopic: ((c.activeTopicId as string | null) ?? '').slice(-10) || null,
      keys: Object.keys(byKey),
      byKey,
      runOps: ops.filter((o: any) => o.status === 'running').length,
    });
  } catch (e: any) {
    timeline.push({
      t: now(),
      activeTopic: null,
      keys: [],
      byKey: {},
      runOps: 0,
      err: e?.message ?? String(e),
    });
  }
}
captureTimeline();
if (w.__PROBE_TIMELINE_TIMER) clearInterval(w.__PROBE_TIMELINE_TIMER);
w.__PROBE_TIMELINE_TIMER = setInterval(captureTimeline, 200);

// ── 5. Tab-switch helpers ──────────────────────────────────────────

function listTopBarTabs(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-insp-path*="TabItem.tsx"][data-contextmenu-trigger]',
    ),
  ).filter((t) => t.getBoundingClientRect().top < 30);
}

w.__listTabs = () =>
  listTopBarTabs().map((t, i) => ({
    i,
    key: t.getAttribute('data-contextmenu-trigger'),
    active: t.getAttribute('data-active') === 'true',
    title: (t.innerText ?? '').slice(0, 60),
  }));

w.__clickTabByKey = (key: string) => {
  const tab = listTopBarTabs().find((t) => t.getAttribute('data-contextmenu-trigger') === key);
  if (!tab) return 'not found: ' + key;
  if (tab.getAttribute('data-active') === 'true') return 'already active: ' + key;
  tab.click();
  return 'clicked key=' + key;
};

w.__PROBE_EVENT = (name: string) => {
  calls.push({ t: now(), name: 'MARK:' + name });
};

// `run.ts` wraps the bundle in an IIFE and appends a `return <confirmation>`
// after the bundle body — agent-browser then prints the confirmation back to
// the operator. Nothing to do here at the end of the module body.
