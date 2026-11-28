/**
 * Gateway-mode Claude Code latency bench. See `budgets.ts` for what each
 * metric means, the recorded baseline, and how to read a run.
 *
 *   bun run bench:cc-gateway --agent <agentId> [--runs 3] [--scenarios hello,image,approve,reject,followUp]
 *                            [--image <path>] [--out <dir>] [--verbose]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { CC_GATEWAY_BUDGETS } from './budgets';
import {
  checkBudgets,
  deriveTurnMetrics,
  type MetricName,
  type ScenarioName,
  type ScenarioSummary,
  summarizeScenario,
  type TurnMetrics,
  type TurnRecord,
} from './metrics';
import { BenchSession, type TurnInput } from './session';
import { uploadBenchImage } from './upload';

const ALL_SCENARIOS: ScenarioName[] = ['hello', 'followUp', 'image', 'approve', 'reject'];

const { values } = parseArgs({
  options: {
    agent: { type: 'string' },
    image: { type: 'string' },
    out: { type: 'string' },
    runs: { default: '3', type: 'string' },
    scenarios: { default: ALL_SCENARIOS.join(','), type: 'string' },
    timeout: { default: '180', type: 'string' },
    verbose: { default: false, type: 'boolean' },
  },
});

if (!values.agent) {
  console.error('--agent <agentId> is required (a Claude Code agent targeting a connected device)');
  process.exit(1);
}

const agentId = values.agent;
const runs = Number(values.runs);
const timeoutMs = Number(values.timeout) * 1000;
if (!Number.isInteger(runs) || runs < 1) {
  console.error(`--runs must be a positive integer, got "${values.runs}"`);
  process.exit(1);
}
if (!(timeoutMs > 0)) {
  console.error(`--timeout must be a positive number of seconds, got "${values.timeout}"`);
  process.exit(1);
}
const scenarios = values.scenarios!.split(',').map((s) => s.trim()) as ScenarioName[];
for (const scenario of scenarios) {
  if (!ALL_SCENARIOS.includes(scenario)) {
    console.error(`Unknown scenario "${scenario}". Known: ${ALL_SCENARIOS.join(', ')}`);
    process.exit(1);
  }
}

/**
 * A tool call Claude Code asks about in `default` mode on any machine. Bash is
 * a poor probe: Claude Code runs read-only commands such as `echo` without
 * asking, and a user's PreToolUse hook may approve every Bash command it deems
 * safe. A Write outside the working directory always asks.
 */
const approvalPrompt = () =>
  `Use the Write tool to create the file /tmp/lobehub-bench/${Date.now()}.txt containing exactly "42", then reply with "done" only.`;
const HELLO_PROMPT = 'hello, reply with one short sentence';

const buildTurns = async (scenario: ScenarioName, topicId?: string): Promise<TurnInput[]> => {
  const base = { agentId, scenario, timeoutMs };
  switch (scenario) {
    case 'hello': {
      return [{ ...base, prompt: HELLO_PROMPT }];
    }
    case 'followUp': {
      return [{ ...base, prompt: 'and one more short sentence, please', topicId }];
    }
    case 'image': {
      const fileId = await uploadBenchImage(values.image);
      return [{ ...base, fileIds: [fileId], prompt: 'What is in this image? One short sentence.' }];
    }
    case 'approve':
    case 'reject': {
      return [
        {
          ...base,
          approval: scenario,
          permissionMode: 'default',
          prompt: approvalPrompt(),
        },
      ];
    }
  }
};

const formatMs = (value: number | undefined) =>
  value === undefined ? '—' : value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;

const printTurn = (turn: TurnRecord, metrics: TurnMetrics) => {
  const parts = (Object.entries(metrics) as [MetricName, number | undefined][])
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${formatMs(value)}`);
  console.log(`  ${turn.scenario.padEnd(8)} ${parts.join('  ')}  op=${turn.operationId}`);
  if (values.verbose) {
    for (const event of turn.events)
      console.log(`      +${String(event.at).padStart(6)}ms  ${event.type} ${event.detail ?? ''}`);
  }
};

const main = async () => {
  const session = await BenchSession.open();
  const records: TurnRecord[] = [];
  const metricsByScenario: Partial<Record<ScenarioName, TurnMetrics[]>> = {};

  try {
    for (let run = 1; run <= runs; run++) {
      console.log(`run ${run}/${runs}`);
      let helloTopicId: string | undefined;
      for (const scenario of scenarios) {
        // A follow-up continues the hello turn's topic so Claude Code resumes.
        if (scenario === 'followUp' && !helloTopicId) {
          const [hello] = await buildTurns('hello');
          helloTopicId = (await session.runTurn({ ...hello, scenario: 'hello' })).topicId;
        }
        for (const input of await buildTurns(scenario, helloTopicId)) {
          const turn = await session.runTurn(input);
          if (scenario === 'hello') helloTopicId = turn.topicId;
          const metrics = deriveTurnMetrics(turn);
          records.push(turn);
          (metricsByScenario[scenario] ??= []).push(metrics);
          printTurn(turn, metrics);
        }
      }
    }
  } finally {
    session.close();
  }

  const summaries: Partial<Record<ScenarioName, ScenarioSummary>> = {};
  console.log('\np50 / p90 per scenario');
  for (const [scenario, turns] of Object.entries(metricsByScenario) as [
    ScenarioName,
    TurnMetrics[],
  ][]) {
    const summary = summarizeScenario(turns);
    summaries[scenario] = summary;
    const parts = (Object.entries(summary) as [MetricName, { p50: number; p90: number }][]).map(
      ([name, stats]) => `${name} ${formatMs(stats.p50)}/${formatMs(stats.p90)}`,
    );
    console.log(`  ${scenario.padEnd(8)} ${parts.join('  ')}`);
  }

  const violations = checkBudgets(summaries, CC_GATEWAY_BUDGETS, runs);
  const outDir =
    values.out ?? path.resolve(import.meta.dirname, '../../../reports/cc-gateway-latency');
  mkdirSync(outDir, { recursive: true });
  const receipt = path.join(outDir, `${new Date().toISOString().replaceAll(':', '-')}.json`);
  writeFileSync(
    receipt,
    JSON.stringify({ agentId, records, runs, scenarios, summaries, violations }, null, 2),
  );
  console.log(`\nreceipt: ${receipt}`);

  if (violations.length > 0) {
    console.log('\nover budget (p50):');
    for (const v of violations)
      console.log(
        v.samples < runs
          ? `  ${v.scenario}.${v.metric}: produced by ${v.samples}/${runs} turns`
          : `  ${v.scenario}.${v.metric}: ${formatMs(v.actual)} > ${formatMs(v.budget)}`,
      );
    process.exitCode = 1;
  }
};

await main();
