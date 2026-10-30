#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * hellostash 投递健康检查（镜像内置，`docker exec <container> hs-check`）。
 *
 * 用法:
 *   hs-check                    # 只看最近 5 分钟
 *   hs-check --window 1h        # 指定单个窗口
 *   hs-check --all              # 5m / 10m / 1h / 6h / 1d / all 全打
 *   hs-check --json
 *   hs-check --url http://127.0.0.1:8080 --token <token>
 *
 * 窗口内的指标都是历史统计，跨重启会带上旧账。停滞是当下的快照，
 * 固定按最近 1 小时扫描，与展示窗口无关。
 *
 * 退出码: 0 正常, 1 发现问题, 2 检查本身失败。
 */
'use strict';

const WINDOWS = { '5m': 300, '10m': 600, '1h': 3600, '6h': 21600, '1d': 86400, 'all': null };
const DEFAULT_WINDOW = '10m';
const STUCK_WINDOW = 3600;
const STUCK_SECONDS = 300;
const MAX_EVENTS = 200000;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const BASE = opt('url', 'http://127.0.0.1:8080').replace(/\/$/, '');
const TOKEN = opt('token', process.env.QSTASH_TOKEN || '');
const JSON_OUT = flag('json');

if (!TOKEN) {
  console.error('缺少 token: 设置 QSTASH_TOKEN 或 --token');
  process.exit(2);
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function paginate(path, field, { timeField = 'time', stopBefore = null } = {}) {
  const out = [];
  let cursor;
  for (;;) {
    const data = await get(`${path}?count=1000${cursor ? `&cursor=${cursor}` : ''}`);
    const page = data[field] || [];
    out.push(...page);
    cursor = data.cursor;
    if (!cursor || out.length >= MAX_EVENTS) break;
    // 结果按时间倒序，整页都早于下界时后面不必再翻
    if (
      stopBefore !== null &&
      page.length &&
      Math.min(...page.map((e) => e[timeField])) < stopBefore
    )
      break;
  }
  return out;
}

const iso = (ms) => new Date(ms).toISOString();
const short = (url) =>
  url
    .split('/api/')
    .pop()
    .replace(/^workflows\//, '');

function groupByMessage(events) {
  const byMessage = new Map();
  for (const e of events) {
    if (!byMessage.has(e.messageId)) byMessage.set(e.messageId, []);
    byMessage.get(e.messageId).push(e);
  }
  for (const evs of byMessage.values()) evs.sort((a, b) => a.time - b.time);
  return byMessage;
}

function analyze(events, runs) {
  const states = {};
  for (const e of events) states[e.state] = (states[e.state] || 0) + 1;

  let delivered = 0;
  let failed = 0;
  let heavy = 0;
  for (const evs of groupByMessage(events).values()) {
    const last = evs.at(-1);
    if (evs.some((e) => e.state === 'DELIVERED')) delivered += 1;
    if (last.state === 'FAILED') failed += 1;
    const errors = evs.filter((e) => e.state === 'ERROR').length;
    const retried = Math.max(...evs.map((e) => e.retried || 0));
    if (errors >= 2 || retried >= 2) heavy += 1;
  }

  let duplicated = 0;
  for (const e of events) {
    if (String((e.header || {})['Content-Type'] || '').includes(', ')) duplicated += 1;
  }

  const errors = events.filter((e) => e.state === 'ERROR' || e.state === 'FAILED');
  const latestError = errors.length ? Math.max(...errors.map((e) => e.time)) : null;

  const endpointCounts = {};
  for (const e of events) {
    if (e.state !== 'DELIVERED') continue;
    const key = short(e.url);
    endpointCounts[key] = (endpointCounts[key] || 0) + 1;
  }
  const endpoints = Object.entries(endpointCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const runStates = {};
  for (const r of runs) runStates[r.workflowState] = (runStates[r.workflowState] || 0) + 1;

  const total = delivered + failed;
  return {
    events: events.length,
    messages: groupByMessage(events).size,
    states,
    delivered,
    failed,
    successRate: total ? delivered / total : null,
    heavy,
    duplicated,
    latestError,
    endpoints,
    runStates,
    runTotal: runs.length,
  };
}

function stuckScan(events, now) {
  const out = [];
  for (const evs of groupByMessage(events).values()) {
    const last = evs.at(-1);
    if (!['ACTIVE', 'RETRY', 'ERROR', 'FAILED'].includes(last.state)) continue;
    const age = (now - last.time) / 1000;
    if (age <= STUCK_SECONDS) continue;
    out.push({ age, url: short(last.url), detail: last.error || last.responseStatus || '' });
  }
  return out.sort((a, b) => b.age - a.age);
}

function verdict(s, stuck) {
  const problems = [];
  if (s.duplicated) problems.push(`${s.duplicated} 条消息的 Content-Type 被重复拼接`);
  if (s.failed) problems.push(`${s.failed} 条消息最终投递失败`);
  if (stuck && stuck.length) problems.push(`${stuck.length} 条消息停滞超过 ${STUCK_SECONDS}s`);
  if (s.successRate !== null && s.successRate < 0.9) {
    problems.push(`成功率仅 ${(s.successRate * 100).toFixed(0)}%`);
  }
  if (s.runStates.RUN_FAILED) problems.push(`${s.runStates.RUN_FAILED} 个 workflow run 失败`);
  return problems;
}

function printWindow(s, window, multi) {
  const rate = s.successRate === null ? 'n/a' : `${(s.successRate * 100).toFixed(1)}%`;
  const pad = multi ? '  ' : '';
  if (multi) console.log(`\n=== ${window} ===`);
  console.log(
    `${multi ? pad : `${window}  `}事件 ${s.events}, 消息 ${s.messages}, 成功 ${s.delivered}, 失败 ${s.failed}, 成功率 ${rate}`,
  );
  console.log(`${pad}状态: ${JSON.stringify(s.states)}`);
  console.log(`${pad}重试>=2: ${s.heavy}, 重复 Content-Type: ${s.duplicated}`);
  if (s.latestError) console.log(`${pad}最新错误: ${iso(s.latestError).slice(11, 19)}Z`);
  console.log(`${pad}workflow runs: ${JSON.stringify(s.runStates)} (共 ${s.runTotal})`);
  if (s.endpoints.length) {
    console.log(`${pad}成功投递端点: ${s.endpoints.map(([u, n]) => `${u}×${n}`).join(', ')}`);
  }
  console.log(`${pad}结论: ${s.problems.length ? `⚠ ${s.problems.join('; ')}` : '✓ 正常'}`);
}

function printStuck(stuck) {
  console.log(`\n停滞>${STUCK_SECONDS}s（按最近 ${STUCK_WINDOW / 60} 分钟扫描）: ${stuck.length}`);
  for (const d of stuck.slice(0, 8)) {
    const head = Number.isFinite(d.age) ? `${Math.round(d.age)}s` : '?';
    console.log(`  ! ${head} ${d.url} ${d.detail}`);
  }
}

(async () => {
  const now = Date.now();

  let windows;
  if (flag('all')) windows = Object.keys(WINDOWS);
  else if (opt('window')) windows = [opt('window')];
  else windows = [DEFAULT_WINDOW];

  const unknown = windows.find((w) => !(w in WINDOWS));
  if (unknown) {
    console.error(`未知窗口: ${unknown}（可选 ${Object.keys(WINDOWS).join(' / ')}）`);
    process.exit(2);
  }

  const widest = windows.some((w) => WINDOWS[w] === null)
    ? null
    : Math.max(...windows.map((w) => WINDOWS[w]), STUCK_WINDOW);
  const horizon = widest === null ? null : now - widest * 1000;

  const [events, runs, schedules, dlq] = await Promise.all([
    paginate('/v2/logs', 'logs', { stopBefore: horizon }),
    paginate('/v2/workflows/logs', 'runs', {
      timeField: 'workflowRunCreatedAt',
      stopBefore: horizon,
    }),
    get('/v2/schedules'),
    get('/v2/dlq'),
  ]);

  const stuck = stuckScan(
    events.filter((e) => e.time >= now - STUCK_WINDOW * 1000),
    now,
  );
  const multi = windows.length > 1;

  const result = {
    now: iso(now),
    schedules: {
      count: schedules.length,
      destinations: [...new Set(schedules.map((s) => s.destination.split('/api/')[0]))],
      paused: schedules.filter((s) => s.isPaused).map((s) => s.scheduleId),
    },
    dlq: (dlq.messages || []).length,
    stuck,
    windows: {},
  };

  for (const w of windows) {
    const secs = WINDOWS[w];
    const sinceMs = secs === null ? null : now - secs * 1000;
    const scoped = sinceMs === null ? events : events.filter((e) => e.time >= sinceMs);
    const scopedRuns =
      sinceMs === null ? runs : runs.filter((r) => r.workflowRunCreatedAt >= sinceMs);
    const stats = analyze(scoped, scopedRuns);
    stats.problems = verdict(stats, stuck);
    result.windows[w] = stats;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`时间: ${iso(now)}`);
    console.log(
      `Schedule: ${result.schedules.count} 条, 目的地 ${JSON.stringify(result.schedules.destinations)}` +
        (result.schedules.paused.length ? `, 已暂停 ${result.schedules.paused.join(',')}` : ''),
    );
    console.log(`DLQ: ${result.dlq}`);
    for (const w of windows) printWindow(result.windows[w], w, multi);
    if (stuck.length) printStuck(stuck);
  }

  const failed = windows.some((w) => result.windows[w].problems.length);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('检查失败:', err.message);
  process.exit(2);
});
