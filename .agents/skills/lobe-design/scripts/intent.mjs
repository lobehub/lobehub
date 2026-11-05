#!/usr/bin/env node
// lobe-design 抽象指令翻译层。零依赖。
// 「体验不好 / 丑 / 难用 / 有点问题」这类指令没有可执行内容。本模块把原话归一化成：
//   { executable: 可执行表述, stages: [被点到的 stage], measures: [要说清楚的量] }
// 归一化表存放在 scripts/pipeline.json 的 intentSignals（路由的唯一事实源）。
// 判据：说得出「改哪里、看到什么算改好了」的，才叫可执行；说不出的，转成追问。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PIPELINE = JSON.parse(readFileSync(join(skillDir, 'scripts/pipeline.json'), 'utf8'));

/**
 * 把指令里的抽象说法翻译成可执行表述。
 * @param {string} instruction 用户指令原文
 * @returns {{matches: Array, stages: string[], ask: string[], notes: string[]}}
 */
export function translate(instruction) {
  const text = instruction.toLowerCase();
  const matches = [];
  const ask = [];
  const stages = [];
  for (const sig of PIPELINE.intentSignals ?? []) {
    const hit = sig.phrases.find((p) => text.includes(p.toLowerCase()));
    if (!hit) continue;
    if (sig.ask) {
      ask.push({ phrase: hit, ask: sig.ask });
      continue;
    }
    matches.push({ phrase: hit, executable: sig.executable, stages: sig.stages, measures: sig.measures ?? [] });
    for (const s of sig.stages) if (!stages.includes(s)) stages.push(s);
  }
  const notes = matches.map((m) => `「${m.phrase}」→ ${m.executable}（→ ${m.stages.join(' / ')}）`);
  return { matches, stages, ask, notes };
}

const HELP = `lobe-design intent — 抽象指令翻译（零依赖）

用法
  node scripts/intent.mjs "<指令原文>"        归一化成「改哪里 + 看到什么算改好了」
  node scripts/intent.mjs "<指令>" --json     JSON 输出

把「体验不好 / 丑 / 难用 / 太乱 / 看不清 / 找不到 / 太慢 / 有点土」这类没有可执行内容的说法，
翻译成可执行表述 + 要说清楚的量 + 目标 stage。归一化不了的（「感觉不对」）转成追问。
归一化表在 scripts/pipeline.json 的 intentSignals（唯一事实源）。

退出码：0 正常 · 2 用法错误`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(HELP); process.exit(0); }
  const instruction = args.filter((a) => !a.startsWith('--')).join(' ');
  if (!instruction) { console.error(`用法错误：缺少指令。\n\n${HELP}`); process.exit(2); }
  const r = translate(instruction);
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  if (!r.matches.length && !r.ask.length) { console.log('没有检测到抽象说法。'); process.exit(0); }
  console.log('可执行化：');
  for (const m of r.matches) console.log(`  「${m.phrase}」→ ${m.executable}\n      要说清楚的量：${m.measures.join('；') || '—'}\n      进入：${m.stages.join(' / ')}`);
  if (r.ask.length) {
    console.log('需要追问（说不清哪里不好，先问再动手）：');
    for (const a of r.ask) console.log(`  「${a.phrase}」→ 追问：${a.ask}`);
  }
}
