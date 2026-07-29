#!/usr/bin/env node
/**
 * Analyze agent-browser KLM trace JSONL into a compact interactionCost object.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'goms-klm@lobe-v1';
const TIMING_SECONDS = {
  H: 0.4,
  K: 0.2,
  M: 1.35,
  P: 1.1,
  T_char: 0.2,
};

const emptyOperators = () => ({
  H: 0,
  K: 0,
  M: 0,
  P: 0,
  R_ms: 0,
  T_chars: 0,
});

const usage = () => {
  console.log(`Usage:
  agent-browser-klm-analyze.mjs --trace interaction-trace.jsonl [--result result.json --write] [--markdown]

Options:
  --trace <file>      JSONL trace from agent-browser-klm.mjs
  --result <file>     result.json to patch with interactionCost
  --write             overwrite --result with interactionCost
  --markdown          print a markdown section instead of JSON
  --model <id>        model id label (default: ${MODEL})`);
};

const parseArgs = (argv) => {
  const options = { markdown: false, model: MODEL, write: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--trace') options.trace = argv[++index];
    else if (arg === '--result') options.result = argv[++index];
    else if (arg === '--model') options.model = argv[++index] ?? MODEL;
    else if (arg === '--write') options.write = true;
    else if (arg === '--markdown') options.markdown = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.trace) throw new Error('--trace is required');
  if (options.write && !options.result) throw new Error('--write requires --result');

  return options;
};

const addOperators = (target, source = {}) => {
  target.H += Number(source.H ?? 0);
  target.K += Number(source.K ?? 0);
  target.M += Number(source.M ?? 0);
  target.P += Number(source.P ?? 0);
  target.R_ms += Number(source.R_ms ?? 0);
  target.T_chars += Number(source.T_chars ?? 0);
};

const round = (value) => Math.round(value * 100) / 100;

const secondsFromOperators = (operators) =>
  round(
    operators.H * TIMING_SECONDS.H +
      operators.K * TIMING_SECONDS.K +
      operators.M * TIMING_SECONDS.M +
      operators.P * TIMING_SECONDS.P +
      operators.T_chars * TIMING_SECONDS.T_char +
      operators.R_ms / 1000,
  );

const activeSecondsFromOperators = (operators) =>
  round(
    operators.H * TIMING_SECONDS.H +
      operators.K * TIMING_SECONDS.K +
      operators.M * TIMING_SECONDS.M +
      operators.P * TIMING_SECONDS.P +
      operators.T_chars * TIMING_SECONDS.T_char,
  );

const phaseKey = (event) =>
  event.phase?.id || event.phase?.checkItemId || event.checkItemId || 'unscoped';

const phaseLabel = (event, key) =>
  event.phase?.label || (key === 'unscoped' ? event.phase?.checkItemId : key) || 'Unscoped actions';

const parseTrace = async (tracePath) => {
  const raw = await readFile(tracePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`, { cause: error });
      }
    });
};

const summarize = (events, { model, tracePath }) => {
  const operators = emptyOperators();
  const phases = new Map();
  const categoryCounts = {};
  const mentalEstimates = [];
  let actualAgentMs = 0;

  for (const event of events) {
    const eventOperators = event.klm?.operators ?? emptyOperators();
    addOperators(operators, eventOperators);

    const category = event.klm?.category ?? 'unknown';
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    actualAgentMs += Number(event.durationMs ?? 0);

    if (event.type === 'mental_estimate' && event.mentalEstimate) {
      mentalEstimates.push({
        confidence: event.mentalEstimate.confidence,
        mOperators: event.mentalEstimate.mOperators,
        phaseId: event.phase?.id,
        reason: event.mentalEstimate.reason,
        score: event.mentalEstimate.score,
      });
    }

    const key = phaseKey(event);
    const existing = phases.get(key) ?? {
      actionCount: 0,
      actualAgentMs: 0,
      checkItemId: event.phase?.checkItemId,
      id: key,
      label: phaseLabel(event, key),
      operators: emptyOperators(),
    };

    addOperators(existing.operators, eventOperators);
    existing.actionCount += 1;
    existing.actualAgentMs += Number(event.durationMs ?? 0);
    phases.set(key, existing);
  }

  const phaseItems = [...phases.values()].map((phase) => ({
    ...phase,
    activeSeconds: activeSecondsFromOperators(phase.operators),
    actualAgentSeconds: round(phase.actualAgentMs / 1000),
    seconds: secondsFromOperators(phase.operators),
    waitSeconds: round(phase.operators.R_ms / 1000),
  }));

  return {
    actionCount: events.length,
    activeSeconds: activeSecondsFromOperators(operators),
    actualAgentSeconds: round(actualAgentMs / 1000),
    categoryCounts,
    generatedAt: new Date().toISOString(),
    mentalEstimates,
    model,
    operators,
    phases: phaseItems.sort((a, b) => b.seconds - a.seconds),
    scope: 'user-equivalent',
    sourceTrace: path.basename(tracePath),
    timingSeconds: TIMING_SECONDS,
    totalSeconds: secondsFromOperators(operators),
    waitSeconds: round(operators.R_ms / 1000),
  };
};

const toMarkdown = (summary) => {
  const topPhases = summary.phases.slice(0, 5);
  const phaseRows = topPhases
    .map(
      (phase) =>
        `| ${phase.label} | ${phase.seconds.toFixed(2)}s | ${phase.activeSeconds.toFixed(2)}s | ${phase.waitSeconds.toFixed(2)}s |`,
    )
    .join('\n');

  return `## GOMS-KLM 交互成本

- 模型：\`${summary.model}\`
- 用户等效总成本：${summary.totalSeconds.toFixed(2)}s
- 主动操作成本：${summary.activeSeconds.toFixed(2)}s
- 系统等待成本：${summary.waitSeconds.toFixed(2)}s
- 操作符：K=${summary.operators.K}, P=${summary.operators.P}, H=${summary.operators.H}, M=${summary.operators.M}, T=${summary.operators.T_chars} chars, R=${summary.operators.R_ms}ms

| 阶段 | 总成本 | 主动 | 等待 |
| --- | ---: | ---: | ---: |
${phaseRows || '| 无 | 0.00s | 0.00s | 0.00s |'}
`;
};

const patchResult = async (resultPath, summary, write) => {
  const raw = await readFile(resultPath, 'utf8');
  const result = JSON.parse(raw);
  result.interactionCost = summary;

  if (write) {
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  return result;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const tracePath = path.resolve(options.trace);
  const events = await parseTrace(tracePath);
  const summary = summarize(events, { model: options.model, tracePath });

  if (options.result) await patchResult(path.resolve(options.result), summary, options.write);

  if (options.markdown) console.log(toMarkdown(summary));
  else console.log(JSON.stringify(summary, null, 2));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[agent-browser-klm-analyze]', error.message);
    process.exit(1);
  });
}
