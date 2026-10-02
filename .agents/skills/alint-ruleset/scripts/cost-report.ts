/**
 * Summarise alint token usage and estimate cost.
 *
 *   bun .agents/skills/alint-ruleset/scripts/cost-report.ts <run.json> [more.json ...]
 *     [--price-in 1] [--price-in-hit 0.1] [--price-out 2] [--currency ¥] [--out <dir>]
 *
 * Inputs are either `alint --format json` dumps (read `usage` + `execution` directly) or a
 * `runs.json` produced by pull-alint-runs.ts (the usage line is parsed out of each run summary,
 * e.g. `42 model calls, 12 cached · 12,345 input / 678 output tokens`). Prices are per million
 * tokens; they are estimates to be re-derived from the bill, not constants. `--price-in-hit`
 * applies only when a source reports cached input tokens separately; the default alint `usage`
 * payload does not, so treat its number as an upper bound.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface UsageRecord {
  inputTokens?: number;
  outputTokens?: number;
  ruleId?: string;
  totalTokens?: number;
}

interface AlintDump {
  diagnostics?: unknown[];
  execution?: { cached?: number; completed?: number; failed?: number; planned?: number };
  usage?: {
    cachedInputTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    records?: UsageRecord[];
    totalTokens?: number;
  };
}

interface RunsFile {
  runs?: { annotations?: number; pr: number; summary?: string; title?: string | null }[];
}

const parseArgs = (argv: string[]) => {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      flags.set(key!, inline ?? argv[++index] ?? '');
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
};

const { flags, positional } = parseArgs(process.argv.slice(2));
if (positional.length === 0) {
  console.error('usage: cost-report.ts <run.json ...> [--price-in 1] [--price-in-hit 0.1] [--price-out 2]');
  process.exit(2);
}

const priceIn = Number(flags.get('price-in') ?? 1);
const priceInHit = Number(flags.get('price-in-hit') ?? 0.1);
const priceOut = Number(flags.get('price-out') ?? 2);
const currency = flags.get('currency') ?? '¥';
const outDir = flags.get('out') ? path.resolve(flags.get('out')!) : undefined;

const perMillion = (tokens: number, price: number) => (tokens / 1_000_000) * price;

interface Row {
  cached: number;
  completed: number;
  cost: number;
  input: number;
  name: string;
  output: number;
  rules: number;
}

const toNumber = (value: string | undefined): number => {
  if (!value) return 0;
  const match = value.replaceAll(',', '').trim().match(/^([\d.]+)\s*([km])?$/i);
  if (!match) return 0;
  const unit = match[2]?.toLowerCase();
  const scale = unit === 'm' ? 1_000_000 : unit === 'k' ? 1000 : 1;
  return Number(match[1]) * scale;
};

/**
 * Read usage out of an ALint run summary (`packages/alint/report.ts` → `toUsageLine`). The exact
 * wording may drift, so pull each number with its own simple pattern instead of one
 * backtracking-prone expression.
 */
const usageFromSummary = (summary: string) => {
  const calls = summary.match(/(\d+)\s*model calls?/i);
  const cached = summary.match(/(\d+)\s*(?:cache hits?|cached)/i);
  const input = summary.match(/([\d.,]+[km]?)\s*(?:input|prompt)/i);
  const output = summary.match(/([\d.,]+[km]?)\s*output/i);
  if (!calls && !cached && !input && !output) return null;
  return {
    cached: cached ? Number(cached[1]) : 0,
    input: toNumber(input?.[1]),
    output: toNumber(output?.[1]),
  };
};

const rows: Row[] = [];
const ruleTotals = new Map<string, { input: number; output: number; total: number }>();

for (const file of positional) {
  const raw = JSON.parse(await readFile(file, 'utf8')) as AlintDump & RunsFile;
  const name = path.basename(file);

  if (raw.usage) {
    const input = raw.usage.inputTokens ?? 0;
    const output = raw.usage.outputTokens ?? 0;
    const hit = raw.usage.cachedInputTokens ?? 0;
    const records = raw.usage.records ?? [];
    for (const record of records) {
      if (!record.ruleId) continue;
      const agg = ruleTotals.get(record.ruleId) ?? { input: 0, output: 0, total: 0 };
      agg.input += record.inputTokens ?? 0;
      agg.output += record.outputTokens ?? 0;
      agg.total += record.totalTokens ?? 0;
      ruleTotals.set(record.ruleId, agg);
    }
    rows.push({
      cached: raw.execution?.cached ?? 0,
      completed: raw.execution?.completed ?? 0,
      cost: perMillion(input - hit, priceIn) + perMillion(hit, priceInHit) + perMillion(output, priceOut),
      input,
      name,
      output,
      rules: new Set(records.map((record) => record.ruleId)).size,
    });
    continue;
  }

  if (raw.runs) {
    let input = 0;
    let output = 0;
    let cached = 0;
    let unparsed = 0;
    for (const run of raw.runs) {
      const usage = run.summary ? usageFromSummary(run.summary) : null;
      if (!usage) {
        unparsed++;
        continue;
      }
      cached += usage.cached;
      input += usage.input;
      output += usage.output;
    }
    rows.push({
      cached,
      completed: raw.runs.length,
      cost: perMillion(input, priceIn) + perMillion(output, priceOut),
      input,
      name: `${name} (CI runs)`,
      output,
      rules: 0,
    });
    console.info(`${unparsed}/${raw.runs.length} runs had no parsable usage line — CI cost is unknown for those, not zero.`);
    continue;
  }

  console.warn(`! ${name}: not an alint dump or a runs.json — skipped`);
}

const money = (value: number) => `${currency}${value.toFixed(2)}`;
const table: string[] = [
  '# alint cost report',
  '',
  `> Prices (per M tokens, as passed): input ${priceIn}, input-hit ${priceInHit}, output ${priceOut}. Estimates — re-derive from the bill and name the key.`,
  '',
  '| source | rules | planned/completed | cached | input | output | est. cost |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for (const row of rows) {
  table.push(
    `| ${row.name} | ${row.rules || '-'} | ${row.completed} | ${row.cached} | ${row.input.toLocaleString()} | ${row.output.toLocaleString()} | ${money(row.cost)} |`,
  );
}
const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
const totalInput = rows.reduce((sum, row) => sum + row.input, 0);
const totalOutput = rows.reduce((sum, row) => sum + row.output, 0);
table.push(`| **total** | | | | **${totalInput.toLocaleString()}** | **${totalOutput.toLocaleString()}** | **${money(totalCost)}** |`);

if (ruleTotals.size > 0) {
  table.push('', '## By rule', '', '| rule | input | output | total |', '| --- | ---: | ---: | ---: |');
  for (const [rule, agg] of [...ruleTotals].sort((a, b) => b[1].total - a[1].total)) {
    table.push(`| \`${rule}\` | ${agg.input.toLocaleString()} | ${agg.output.toLocaleString()} | ${agg.total.toLocaleString()} |`);
  }
}

const body = table.join('\n') + '\n';
console.info(body);
if (outDir) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'cost-report.md'), body);
  console.info(`\ncost-report.md → ${outDir}`);
}
