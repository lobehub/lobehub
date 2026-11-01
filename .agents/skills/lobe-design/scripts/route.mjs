#!/usr/bin/env node
// lobe-design router: instruction -> scenario + granularity + ordered stages + files to load.
// Usage: node scripts/route.mjs "<instruction>" [--json] [--has-brief]
// Zero dependencies. Rules live in scripts/pipeline.json (single source of truth).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS } from './check-detail.mjs';
import { RULES } from './lint-lobe.mjs';
import { translate } from './intent.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PIPELINE = JSON.parse(readFileSync(join(here, 'pipeline.json'), 'utf8'));

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ');

// Find keyword hits with spans; drop hits fully contained in a longer hit (e.g. "视觉" inside "视觉方向").
function findHits(text, table) {
  const hits = [];
  for (const [owner, words] of table) {
    for (const w of words) {
      const k = w.toLowerCase();
      let i = text.indexOf(k);
      while (i !== -1) {
        hits.push({ owner, word: w, start: i, end: i + k.length });
        i = text.indexOf(k, i + 1);
      }
    }
  }
  return hits.filter(
    (h) => !hits.some((o) => o !== h && o.end - o.start > h.end - h.start && o.start <= h.start && o.end >= h.end),
  );
}

// LOBE-* → the lint rule's `stage`; DETAIL-* → 70-detail (check-detail only serves 70).
// Meta rules whose stage is not a pipeline stage (LOBE-IGNORE-NO-REASON → learnings) have no owner.
function checkOwner(id) {
  if (id.startsWith('DETAIL-')) return CHECKS.some((c) => c.id === id) ? '70-detail' : null;
  const st = RULES.find((r) => r.id === id)?.stage;
  return st && PIPELINE.stages[st] ? st : null;
}

function ruleOwner(id) {
  const owners = PIPELINE.ruleOwners;
  const base = id.toUpperCase().split('.')[0];
  if (owners[base]) return owners[base];
  const letter = base.split('-')[0];
  return owners[letter];
}

export function route(instruction, { hasBrief = false } = {}) {
  const text = norm(instruction);
  const { stages, scenarios, stageOrder } = PIPELINE;
  const reasons = [];

  // 0) 抽象指令翻译：「体验不好」「丑」这类原话没有可执行内容，先归一化成 stage + 量。
  //    命中的 stage 会和关注点合流；纯抽象、无法归一化时转成追问（granularity: clarify）。
  const intent = translate(instruction);

  // 1) rule ids named explicitly -> owning stage.
  //    Reference ids (C/D/K/E/P/A/W/M/T 两位编号, X-n.n 清单项) via ruleOwners; lint / detail ids via the
  //    script's own `stage` field, so routing can never drift from what the checker reports.
  //    Only ids that actually resolve to a stage count: a stray "LOBE-design" in prose is not a rule id.
  const refIds = [...instruction.matchAll(/\b(?:[CDKEPAWXMT]-\d{2}|X-\d)(?:\.\d+)?\b/gi)].map((m) => m[0].toUpperCase());
  const checkIds = [...instruction.matchAll(/\b(?:LOBE|DETAIL)-[A-Z0-9-]+\b/gi)]
    .map((m) => m[0].toUpperCase())
    .filter((id) => checkOwner(id));
  const ruleIds = [...refIds, ...checkIds];
  const ruleStages = [...new Set([...refIds.map(ruleOwner), ...checkIds.map(checkOwner)].filter(Boolean))];

  // 模型的口语说法（「格式塔」「双钻」）确定归属 stage，但**不算点名规则编号**：
  // 它是「用哪副眼镜看」，不是「改哪一行」。所以它只贡献关注点，不触发 fine 的直连语义。
  const modelStages = [...new Set(Object.entries(PIPELINE.modelSignals ?? {})
    .filter(([word]) => !word.startsWith('$') && text.includes(word.toLowerCase()))
    .map(([, id]) => ruleOwner(id) ?? checkOwner(id))
    .filter(Boolean))];
  if (modelStages.length) reasons.push(`模型词指定了分析视角 → ${modelStages.join(', ')}`);
  if (ruleIds.length) reasons.push(`点名规则 ${ruleIds.join(', ')} → ${ruleStages.join(', ') || '（无归属 stage）'}`);

  // 2) concern hits per stage (00 excluded: it always runs first).
  //    A named rule id is authoritative: keyword hits are then only reported (e.g. 「LOBE-RAW-COLOR 报错」
  //    must go to 50, not to 70 because of the word「报错」).
  const concernTable = Object.entries(stages)
    .filter(([id]) => id !== '00-brief')
    .map(([id, s]) => [id, s.keywords]);
  const concernHits = findHits(text, concernTable);
  const keywordStages = ruleStages.length
    ? stageOrder.filter((id) => ruleStages.includes(id))
    : stageOrder.filter((id) => concernHits.some((h) => h.owner === id));
  if (concernHits.length)
    reasons.push(`关注点命中${ruleStages.length ? '（已被点名规则覆盖，仅记录）' : ''}：${concernHits.map((h) => `${h.word}→${h.owner}`).join('，')}`);

  // 2b) 抽象说法归一化出来的 stage 与关注点合流。
  //     点名了规则编号时不参与（编号已经足够精确，代号优先于措辞）。
  const intentStages = ruleStages.length ? [] : stageOrder.filter((id) => intent.stages.includes(id));
  const concernStages = stageOrder.filter((id) => keywordStages.includes(id) || intentStages.includes(id) || modelStages.includes(id));
  if (intentStages.length) reasons.push(`抽象指令已归一化：${intent.notes.join('；')}`);

  // 3) scenario detection
  const scenarioHits = findHits(
    text,
    Object.entries(scenarios).map(([id, s]) => [id, s.signals]),
  );
  const hitSet = new Set(scenarioHits.map((h) => h.owner));
  let scenario = null;
  const buildHit = scenarios['operate-build'].buildSignals.some((w) => text.includes(w.toLowerCase()));
  // An existing visual page that is only being polished (打磨/优化… and no build signal) is product-polish:
  // it keeps its direction, so 20-direction must not run (SKILL.md「launch-visual 和 product-polish」).
  const polishOnlyVisual = hitSet.has('launch-visual') && hitSet.has('product-polish') && !buildHit;
  for (const id of PIPELINE.scenarioPriority) {
    if (id === 'launch-visual' && polishOnlyVisual) {
      reasons.push('视觉页 + 打磨信号且无新建信号 → 降为 product-polish（沿用现有方向）');
      continue;
    }
    if (id === 'operate-build') {
      if (hitSet.has('operate-build') && buildHit) { scenario = id; break; }
      continue;
    }
    if (id === 'product-polish') {
      if (hitSet.has('product-polish') || hitSet.has('operate-build')) { scenario = id; break; }
      continue;
    }
    if (hitSet.has(id)) { scenario = id; break; }
  }
  if (scenarioHits.length)
    reasons.push(`场景信号：${scenarioHits.map((h) => `${h.word}→${h.owner}`).join('，')}${buildHit ? '（含新建信号）' : ''}`);

  const macroSignal = PIPELINE.macroSignals.some((w) => text.includes(w.toLowerCase()));
  const anchor = scenario ? PIPELINE.anchorStages[scenario] : null;
  const onlyAnchor = anchor && concernStages.length > 0 && concernStages.every((s) => s === anchor);

  // 4) granularity
  let granularity;
  if (ruleIds.length && concernStages.length === 1) granularity = 'fine';
  else if (scenario && (macroSignal || concernStages.length === 0 || onlyAnchor || concernStages.length >= 4)) granularity = 'macro';
  else if (!scenario && concernStages.length >= 4) granularity = 'macro';
  else if (concernStages.length === 1) granularity = 'fine';
  else if (concernStages.length >= 2) granularity = 'medium';
  else if (intent.ask.length) granularity = 'clarify';
  else granularity = 'ambiguous';

  if (granularity === 'macro' && !scenario) scenario = 'product-polish';

  // 5) build the plan. Business first: every plan starts at 00-brief.
  let plan;
  if (granularity === 'macro') {
    const sc = scenarios[scenario];
    const briefMode = hasBrief ? 'reuse' : sc.briefMode;
    plan = sc.pipeline.map(([stage, note], i) =>
      i === 0 && stage === '00-brief' ? [stage, `${note}（brief 模式：${briefMode}）`] : [stage, note],
    );
    reasons.push(`宏观 → 场景「${sc.title}」的默认 pipeline`);
  } else if (granularity === 'medium' || granularity === 'fine') {
    plan = [['00-brief', hasBrief ? '复用已有 brief' : 'lite：一行 页面类型 · 主任务 · 密度倾向']];
    // 只点名了 00 自己的规则（M-01 双钻 / M-04 Kano）时，它本身就是 00 的工作：
    // 把编号写进说明即可，不额外跑一遍 00，也不需要自查（没有代码改动）。
    const onlyBriefStage = concernStages.length > 0 && concernStages.every((s) => s === '00-brief');
    for (const s of concernStages) {
      if (s === '00-brief') {
        const ids = [...new Set(ruleIds)].filter(Boolean);
        if (ids.length) plan[0][1] = `${plan[0][1]}；并做被点名的部分（${ids.join(', ')}）`;
        continue;
      }
      plan.push([s, granularity === 'fine' ? '直达，只做被点名的部分' : '只处理被点名的关注点']);
    }
    if (granularity === 'fine' && !onlyBriefStage) plan.push(['@selfcheck', '跑 lint-lobe.mjs + 本 stage 检查清单做范围内自查（不做完整 80 评分）']);
    reasons.push(granularity === 'fine'
      ? (onlyBriefStage ? '精细，且只点名了 00 自己的规则 → 只做 00（分析型，无代码改动）' : '精细 → 直达单个 stage')
      : `中等 → 只跑 ${concernStages.length} 个被点名的 stage，按 stageOrder 排序`);
  } else {
    plan = [];
    reasons.push(granularity === 'clarify'
      ? '指令是纯抽象说法，没有可执行内容 → 先追问，不猜着动手'
      : '指令缺少场景和关注点 → 推荐 2–3 条路径，不自动执行');
  }

  const loads = [];
  for (const [s] of plan) {
    const st = stages[s];
    if (!st) continue;
    loads.push({ stage: s, file: st.file, refs: st.loads });
  }

  return {
    instruction,
    scenario,
    scenarioTitle: scenario ? scenarios[scenario].title : null,
    granularity,
    ruleIds,
    plan: plan.map(([stage, note]) => {
      const title = stages[stage]?.title;
      return { stage, title: title ?? null, note };
    }),
    loads,
    intent: { notes: intent.notes, ask: intent.ask, stages: intentStages },
    suggestions: granularity === 'ambiguous' ? PIPELINE.ambiguousSuggestions : [],
    reasons,
  };
}

function format(r) {
  const out = [];
  out.push(`指令：${r.instruction}`);
  out.push(`场景：${r.scenario ? `${r.scenario}（${r.scenarioTitle}）` : '未识别'}　颗粒度：${r.granularity}`);
  if (r.plan.length) {
    out.push('Pipeline：' + r.plan.map((p) => p.stage).join(' → '));
    r.plan.forEach((p, i) => out.push(`  ${i + 1}. ${p.stage}${p.title ? ' ' + p.title : ''} —— ${p.note}`));
    out.push('按需加载（进入该 stage 时才读；先跑 `node scripts/refs.mjs "<指令>"` 拿到具体条目）：');
    r.loads.forEach((l) => out.push(`  ${l.stage}: ${l.file} + ${l.refs.join(', ') || '—'}`));
  }
  if (r.intent?.notes?.length) {
    out.push('抽象指令归一化：');
    r.intent.notes.forEach((n) => out.push(`  - ${n}`));
  }
  if (r.intent?.ask?.length) {
    out.push('先追问（不猜着动手）：');
    r.intent.ask.forEach((a) => out.push(`  - 「${a.phrase}」→ ${a.ask}`));
  }
  if (r.suggestions.length) {
    out.push('建议路径（请用户选择）：');
    r.suggestions.forEach((s) => out.push(`  - ${s}`));
  }
  out.push('依据：');
  r.reasons.forEach((s) => out.push(`  - ${s}`));
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const hasBrief = args.includes('--has-brief');
  const instruction = args.filter((a) => !a.startsWith('--')).join(' ');
  if (!instruction) {
    console.error('Usage: node scripts/route.mjs "<instruction>" [--json] [--has-brief]');
    process.exit(2);
  }
  const r = route(instruction, { hasBrief });
  console.log(json ? JSON.stringify(r, null, 2) : format(r));
}
