#!/usr/bin/env node
// Analyze a probe dump captured by probe.js + probe-dump.js.
//
//   node analyze.mjs /tmp/probe.json
//
// Prints:
//   1. EVENTS — user-action markers with their relative timestamps
//   2. TIMELINE — periodic samples (~1 per second + event-adjacent samples)
//      showing every interesting field; columns:
//        t(ms) | runOps | msgN | childN | content | reasoning | tools | domLen | search | crawl | topic | event
//   3. REGRESSIONS — every place a tracked counter *dropped* on the same
//      topic between adjacent samples. A "true" UI rollback shows up as a
//      drop in content/reasoning/tools/childN/domLen without a topic change.
//
// Whitelisted transitions (not flagged):
//   - topic change → all drops expected (focus moved away)
//   - reasoning length 0 after content starts → reasoning gets sealed into a
//     completed sub-block; the parent's running reasoning resets to ''.
//   - msgN drop when topic transitions from `_new` placeholder to a real id.

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node analyze.mjs <probe.json>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
// probe-dump.js wraps the payload in JSON.stringify so agent-browser returns
// it as a single quoted string. Unwrap.
const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
const { events, samples } = data;

const fmt = {
  pad(v, n) {
    return String(v).padStart(n);
  },
};

console.log('=== EVENTS ===');
for (const e of events) console.log(`  t=${fmt.pad(e.t, 7)}  ${e.name}`);

console.log(
  '\n=== TIMELINE (~1s cadence, plus event-adjacent samples) ===\n' +
    '  t(ms)   runOps  msgN childN  content reasoning tools  domLen  search crawl  topic     event',
);

let lastSampledAt = -1e9;
const eventBuckets = events.map((e) => e.t);
for (let i = 0; i < samples.length; i++) {
  const s = samples[i];
  const nearEvent = eventBuckets.some((et) => Math.abs(et - s.t) < 110);
  if (!nearEvent && s.t - lastSampledAt < 1000) continue;
  lastSampledAt = s.t;

  const ev = events.find((e) => Math.abs(e.t - s.t) < 110);
  const evMarker = ev ? `  ◀ ${ev.name}` : '';
  const topicSuffix = s.topicId ? s.topicId.slice(-6) : '(none)';
  const search = s.ind?.search ?? 0;
  const crawl = s.ind?.crawl ?? 0;
  console.log(
    `  ${fmt.pad(s.t, 6)} ` +
      `${fmt.pad(s.runOps, 6)}  ` +
      `${fmt.pad(s.msgN, 4)}  ` +
      `${fmt.pad(s.childN ?? 0, 5)} ` +
      `${fmt.pad(s.cT ?? 0, 8)} ` +
      `${fmt.pad(s.rT ?? 0, 9)} ` +
      `${fmt.pad(s.toolT ?? 0, 5)} ` +
      `${fmt.pad(s.domLen ?? 0, 7)} ` +
      `${fmt.pad(search, 6)} ` +
      `${fmt.pad(crawl, 5)}  ` +
      `${topicSuffix.padEnd(8)}${evMarker}`,
  );
}

console.log('\n=== REGRESSIONS (same topic, value dropped) ===');
const regressions = [];
for (let i = 1; i < samples.length; i++) {
  const prev = samples[i - 1];
  const cur = samples[i];
  if (!cur.topicId || prev.topicId !== cur.topicId) continue;

  const drops = [];
  if (cur.msgN < prev.msgN) drops.push(`msgN: ${prev.msgN}→${cur.msgN}`);
  if ((cur.childN ?? 0) < (prev.childN ?? 0)) drops.push(`childN: ${prev.childN}→${cur.childN}`);
  if ((cur.cT ?? 0) < (prev.cT ?? 0)) drops.push(`content: ${prev.cT}→${cur.cT}`);
  if ((cur.rT ?? 0) < (prev.rT ?? 0)) drops.push(`reasoning: ${prev.rT}→${cur.rT}`);
  if ((cur.toolT ?? 0) < (prev.toolT ?? 0)) drops.push(`tools: ${prev.toolT}→${cur.toolT}`);
  // domLen jitters by a few chars from counter labels — only flag big drops.
  if ((cur.domLen ?? 0) < (prev.domLen ?? 0) - 100) {
    drops.push(`domLen: ${prev.domLen}→${cur.domLen}`);
  }
  if (drops.length === 0) continue;

  const nearbyEv = events.filter((e) => Math.abs(e.t - cur.t) < 600).map((e) => e.name);
  regressions.push({ t: cur.t, topic: cur.topicId.slice(-6), drops, nearbyEv });
}

if (regressions.length === 0) {
  console.log('  (none)');
} else {
  for (const r of regressions) {
    const evStr = r.nearbyEv.length ? `  near:[${r.nearbyEv.join(',')}]` : '';
    console.log(`  t=${fmt.pad(r.t, 7)}  topic=${r.topic}  ${r.drops.join(' | ')}${evStr}`);
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`  samples: ${samples.length}`);
console.log(`  events:  ${events.length}`);
console.log(`  regressions: ${regressions.length}`);
if (samples.length) {
  const last = samples.at(-1);
  console.log(
    `  final: msgN=${last.msgN} childN=${last.childN ?? 0} content=${last.cT ?? 0} ` +
      `reasoning=${last.rT ?? 0} tools=${last.toolT ?? 0} runOps=${last.runOps}`,
  );
}
