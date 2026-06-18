// Analyzer for probe-events dumps. Reads a JSON file produced by `run.ts dump`
// and prints a layered breakdown:
//
//   1. STREAM EVENTS — every non-chunk WS/SSE event in receipt order
//   2. CHUNKS SUMMARY — collapsed per-step chunk counts (otherwise floods)
//   3. ACTION CALLS — replaceMessages / refreshMessages / MARK:* with stack
//   4. CORRELATION — calls ↔ nearest stream event within ±300ms
//   5. PER-KEY ASSISTANT GROWTH — for each messagesMap key, when the leading
//      assistant message's cLen / rLen actually moves (this is what reveals
//      "chunks arrived but the message never grew" regressions)
//   6. ROLLBACKS — msgN / childN / role drops in the active-topic timeline
//
// Usage:
//   bun run .agents/skills/agent-testing/scripts/agent-gateway/analyze-events.ts <dump.json>

import { readFileSync } from 'node:fs';

import type {
  ProbeActionCall,
  ProbeDump,
  ProbeMessageSummary,
  ProbeStreamEvent,
  ProbeTimelineSample,
} from './types';

const file = process.argv[2];
if (!file) {
  console.error('usage: bun run analyze-events.ts <dump.json>');
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');
// agent-browser eval --stdin wraps return values in quotes when the value is
// a string — so the JSON file may be double-encoded depending on how it was
// captured. Handle both.
const parsedOnce = JSON.parse(raw) as ProbeDump | string;
const dump: ProbeDump = typeof parsedOnce === 'string' ? JSON.parse(parsedOnce) : parsedOnce;

const { streamEvents = [], actionCalls = [], timeline = [] } = dump;

const pad = (v: unknown, n: number) => String(v).padStart(n);

// ── META ───────────────────────────────────────────────────────────
console.log('=== META ===');
console.log(`  events:    ${streamEvents.length}`);
console.log(`  calls:     ${actionCalls.length}`);
console.log(`  timeline:  ${timeline.length}`);

// ── 1. STREAM EVENTS (non-chunk) ───────────────────────────────────
const nonChunkEvents = streamEvents.filter((e) => e.type !== 'stream_chunk');
const chunkEvents = streamEvents.filter((e) => e.type === 'stream_chunk');

console.log(
  `\n=== STREAM EVENTS (${nonChunkEvents.length} non-chunk + ${chunkEvents.length} chunks elided) ===`,
);
for (const e of nonChunkEvents) {
  const dataStr = e.dataKeys?.length ? ` [${e.dataKeys.join(',')}]` : '';
  const data = e.data as Record<string, unknown> | undefined;
  const uiHint = data?.uiMessagesPreview
    ? ` uiPreview=${JSON.stringify(data.uiMessagesPreview)}`
    : data?.uiMessagesTotal
      ? ` uiTotal=${data.uiMessagesTotal}`
      : '';
  const phaseHint = data?.phase ? ` phase=${data.phase}` : '';
  const extra = e.serverType ? ` serverType=${e.serverType}` : '';
  console.log(
    `  t=${pad(e.t, 7)}  [${(e.transport ?? '?').padEnd(3)}]  step=${pad(e.stepIndex ?? '-', 2)}  ` +
      `type=${(e.type ?? '').padEnd(22)}  op=${e.opIdTail ?? '-'}${phaseHint}${uiHint}${extra}${dataStr}`,
  );
}

// ── 2. CHUNK SUMMARY ───────────────────────────────────────────────
console.log('\n=== CHUNKS SUMMARY (per step / chunkType) ===');
const chunkBuckets = new Map<string, { count: number; firstT: number; lastT: number }>();
for (const c of chunkEvents) {
  const data = c.data as Record<string, unknown> | undefined;
  const ct = (data?.chunkType as string | undefined) ?? '?';
  const key = `step=${c.stepIndex ?? '-'}  chunkType=${ct.padEnd(8)}  op=${c.opIdTail}`;
  const slot = chunkBuckets.get(key);
  if (slot) {
    slot.count += 1;
    slot.lastT = c.t;
  } else {
    chunkBuckets.set(key, { count: 1, firstT: c.t, lastT: c.t });
  }
}
for (const [k, v] of chunkBuckets) {
  console.log(`  ${k}  count=${pad(v.count, 4)}  t=${pad(v.firstT, 7)}..${pad(v.lastT, 7)}`);
}

// ── 3. ACTION CALLS ───────────────────────────────────────────────
console.log('\n=== ACTION CALLS (replace/refresh/MARK) ===');
for (const c of actionCalls) {
  if (c.name?.startsWith('MARK:')) {
    console.log(`  t=${pad(c.t, 7)}  ${c.name}`);
    continue;
  }
  const snapshot = (c.args as any)?.snapshot as
    | Array<{ id: string; role: string; cLen: number; rLen: number }>
    | undefined;
  const snapStr = snapshot?.length
    ? '  snapshot=' + snapshot.map((m) => `${m.id}:${m.role}/c${m.cLen}/r${m.rLen}`).join(' | ')
    : '';
  const summary =
    c.name === 'replaceMessages'
      ? `count=${c.args?.count} action=${(c.args?.params as any)?.action ?? '-'}${snapStr}`
      : c.name === 'refreshMessages'
        ? `ctx=${JSON.stringify(c.args?.context)}`
        : c.error
          ? `error=${c.error}`
          : '';
  console.log(`  t=${pad(c.t, 7)}  ${c.name.padEnd(20)} ${summary}`);
  if (c.stack) {
    const frames = c.stack
      .split(' ← ')
      .filter((f) => !!f && !f.includes('Object.<anonymous>'))
      .slice(0, 3);
    for (const f of frames) console.log(`             ↳ ${f}`);
  }
}

// ── 4. CORRELATION ────────────────────────────────────────────────
function nearestEventForCall(
  call: ProbeActionCall,
  windowMs = 300,
): { event: ProbeStreamEvent; delta: number } | null {
  let best: ProbeStreamEvent | null = null;
  let bestDelta = Infinity;
  for (const e of streamEvents) {
    const d = Math.abs(e.t - call.t);
    if (d < bestDelta && d <= windowMs) {
      bestDelta = d;
      best = e;
    }
  }
  return best ? { event: best, delta: bestDelta } : null;
}

console.log('\n=== CORRELATION (replace/refresh ↔ nearest event within ±300ms) ===');
for (const c of actionCalls) {
  if (c.name !== 'refreshMessages' && c.name !== 'replaceMessages') continue;
  const hit = nearestEventForCall(c);
  if (hit) {
    const phase = (hit.event.data as Record<string, unknown> | undefined)?.phase;
    console.log(
      `  t=${pad(c.t, 7)}  ${c.name.padEnd(16)} ← Δ${pad(hit.delta, 4)}ms ${hit.event.type}` +
        (phase ? ` phase=${phase}` : ''),
    );
  } else {
    console.log(`  t=${pad(c.t, 7)}  ${c.name.padEnd(16)} ← (no event nearby — external trigger)`);
  }
}

// ── 5. PER-KEY ASSISTANT GROWTH ───────────────────────────────────
// For each messagesMap key, find the trailing assistant message and report
// the points in time where its cLen / rLen actually changed. If the timeline
// shows chunks arriving but the assistant cLen never moves, that's the
// signature of "dispatch queue blocked / messageId mismatch".
console.log('\n=== PER-KEY ASSISTANT GROWTH ===');
const keysEverSeen = new Set<string>();
for (const s of timeline) for (const k of Object.keys(s.byKey ?? {})) keysEverSeen.add(k);

for (const key of keysEverSeen) {
  console.log(`\n  key=${key}`);
  let lastSig: string | null = null;
  for (const s of timeline) {
    const slot = s.byKey?.[key];
    if (!slot) continue;
    const last = slot.msgs.at(-1) as ProbeMessageSummary | undefined;
    if (!last) continue;
    const sig = `${last.id}|c${last.cLen}|r${last.rLen}|n${slot.n}`;
    if (sig === lastSig) continue;
    lastSig = sig;
    console.log(
      `    t=${pad(s.t, 7)}  msgN=${pad(slot.n, 3)}  ` +
        `lastAssistant=${last.id}  cLen=${pad(last.cLen, 5)}  rLen=${pad(last.rLen, 5)}` +
        `  runOps=${s.runOps}`,
    );
  }
}

// ── 6. ROLLBACKS (active-topic msgN / childN / role drops) ─────────
console.log('\n=== ROLLBACKS (active-topic msgN / childN / role drops) ===');
let prev: ProbeTimelineSample | null = null;
const rollbacks: Array<{ t: number; topic: string | null; drops: string[] }> = [];

const flatten = (s: ProbeTimelineSample) => {
  if (!s.activeTopic) return [];
  return Object.entries(s.byKey ?? {})
    .filter(([k]) => k.includes(s.activeTopic!))
    .flatMap(([, v]) => v.msgs);
};

for (const s of timeline) {
  if (s.err) {
    prev = null;
    continue;
  }
  if (!prev || prev.activeTopic !== s.activeTopic) {
    prev = s;
    continue;
  }
  const prevMsgs = flatten(prev);
  const curMsgs = flatten(s);
  const drops: string[] = [];

  if (curMsgs.length < prevMsgs.length) drops.push(`msgN ${prevMsgs.length}→${curMsgs.length}`);

  let prevChild = 0;
  let curChild = 0;
  for (const m of prevMsgs) prevChild += m.chN ?? 0;
  for (const m of curMsgs) curChild += m.chN ?? 0;
  if (curChild < prevChild) drops.push(`childN ${prevChild}→${curChild}`);

  const prevById = new Map(prevMsgs.map((m) => [m.id, m]));
  for (const m of curMsgs) {
    const pr = prevById.get(m.id);
    if (!pr) continue;
    if (m.cLen < pr.cLen) drops.push(`cLen[${m.id}] ${pr.cLen}→${m.cLen}`);
    if (m.rLen < pr.rLen) drops.push(`rLen[${m.id}] ${pr.rLen}→${m.rLen}`);
  }

  if (drops.length) rollbacks.push({ t: s.t, topic: s.activeTopic, drops });
  prev = s;
}

if (rollbacks.length === 0) {
  console.log('  (none)');
} else {
  for (const r of rollbacks) {
    const nearEvent = streamEvents
      .filter((e) => Math.abs(e.t - r.t) <= 300)
      .map((e) => `${e.type}${(e.data as any)?.phase ? ':' + (e.data as any).phase : ''}`);
    const nearCall = actionCalls
      .filter((c) => Math.abs(c.t - r.t) <= 300 && !c.name?.startsWith('MARK:'))
      .map((c) => c.name);
    console.log(
      `  t=${pad(r.t, 7)}  topic=${r.topic}  ${r.drops.join(' | ')}` +
        (nearEvent.length ? `  near-event:[${nearEvent.join(',')}]` : '') +
        (nearCall.length ? `  near-call:[${nearCall.join(',')}]` : ''),
    );
  }
}
