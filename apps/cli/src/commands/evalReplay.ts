import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { parseModelTargets } from '@lobechat/agent-tracing/replay';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import type { JsonOption } from './evalShared';
import { executeCommand } from './evalShared';

type ReplayComparison = Awaited<
  ReturnType<Awaited<ReturnType<typeof getTrpcClient>>['agentEval']['getReplayComparison']['query']>
>;

const COMPARISON_POLL_MS = 3000;

const waitForComparison = async (runId: string, timeoutMs: number) => {
  const client = await getTrpcClient();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const comparison = await client.agentEval.getReplayComparison.query({ runId });
    const unfinished = comparison.cells.filter(
      (cell) => cell.status === 'pending' || cell.status === 'running',
    ).length;
    if (unfinished === 0) return comparison;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out with ${unfinished} cell(s) unfinished — check later with ` +
          `\`lh eval compare show --run-id ${runId}\``,
      );
    }
    await sleep(COMPARISON_POLL_MS);
  }
};

const formatCell = (cell: ReplayComparison['cells'][number]) => {
  if (cell.status === 'error') return pc.red(`error (${cell.error?.stage ?? 'replay'})`);
  if (cell.status !== 'completed') return pc.dim(cell.status);
  if (cell.score === null || cell.score === undefined) return 'unjudged';
  const verdict = cell.passed ? pc.green('pass') : pc.red('fail');
  return `${verdict} ${cell.score.toFixed(2)}`;
};

const printComparison = (comparison: ReplayComparison) => {
  const { cases, cells, judge, run, targets } = comparison;
  console.log(
    `${pc.bold(run.name ?? run.id)}  ${pc.dim(run.id)}  status=${run.status}  ` +
      `judge=${judge.provider}/${judge.model}`,
  );

  for (const testCase of cases) {
    console.log(`\n${pc.bold(testCase.id)}  ${pc.dim(testCase.content.input.slice(0, 80))}`);
    for (const target of targets) {
      const cell = cells.find(
        (c) =>
          c.testCaseId === testCase.id &&
          c.provider === target.provider &&
          c.model === target.model,
      );
      if (!cell) continue;
      const label = `${target.provider}/${target.model}`.padEnd(40);
      const duration = cell.durationMs ? pc.dim(` ${cell.durationMs}ms`) : '';
      console.log(`  ${label} ${formatCell(cell)}${duration}`);
      const detail = cell.error?.message ?? cell.judgeReason;
      if (detail) console.log(pc.dim(`    ${detail.replaceAll('\n', ' ').slice(0, 160)}`));
    }
  }
};

/** `lh eval testcase freeze|draft` and `lh eval compare *`: frozen-call replay across models. */
export function registerEvalReplayCommands(evalCmd: Command, testcaseCmd: Command) {
  testcaseCmd
    .command('freeze')
    .description('Freeze the LLM call behind an assistant message into a replayable test case')
    .requiredOption('--dataset-id <id>', 'Dataset ID')
    .requiredOption('--message-id <id>', 'Assistant message whose LLM call is frozen')
    .option(
      '--criteria <text>',
      'Self-contained judge criteria (the judge never sees the conversation)',
    )
    .option('--criteria-file <path>', 'Read the judge criteria from a file')
    .option('--expected <text>', 'Reference answer shown to the judge')
    .option('--positive', 'The captured answer is good (use it as expected)')
    .option('--step <n>', 'Snapshot step to freeze (default: last call_llm)')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          criteria?: string;
          criteriaFile?: string;
          datasetId: string;
          expected?: string;
          messageId: string;
          positive?: boolean;
          step?: string;
        },
      ) =>
        executeCommand(options, async () => {
          const criteria = options.criteriaFile
            ? await readFile(options.criteriaFile, 'utf8')
            : options.criteria;
          if (!criteria?.trim()) {
            throw new InvalidArgumentError('Pass --criteria or --criteria-file');
          }

          const client = await getTrpcClient();
          return client.agentEval.freezeTestCaseFromMessage.mutate({
            capturedOutputKind: options.positive ? 'positive' : 'negative',
            criteria,
            datasetId: options.datasetId,
            expected: options.expected,
            messageId: options.messageId,
            stepIndex: options.step === undefined ? undefined : Number.parseInt(options.step, 10),
          });
        }),
    );

  testcaseCmd
    .command('draft')
    .description(
      'Draft self-contained judge criteria for freezing an assistant message (saves nothing)',
    )
    .requiredOption('--message-id <id>', 'Assistant message to draft criteria for')
    .option('--note <text>', 'What is wrong (or right) about the answer')
    .option('--positive', 'The captured answer is good')
    .option('--locale <locale>', 'Language to write the criteria in, e.g. zh-CN')
    .option('--step <n>', 'Snapshot step to read (default: last call_llm)')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          locale?: string;
          messageId: string;
          note?: string;
          positive?: boolean;
          step?: string;
        },
      ) =>
        executeCommand(options, async () => {
          const client = await getTrpcClient();
          return client.agentEval.draftTestCaseCriteria.mutate({
            capturedOutputKind: options.positive ? 'positive' : 'negative',
            locale: options.locale,
            messageId: options.messageId,
            note: options.note,
            stepIndex: options.step === undefined ? undefined : Number.parseInt(options.step, 10),
          });
        }),
    );

  // ============================================
  // Cross-model comparison (frozen-call replay)
  // ============================================
  const compareCmd = evalCmd
    .command('compare')
    .description('Replay frozen test cases against several models and judge each output');

  compareCmd
    .command('start')
    .description('Start a cross-model comparison over the frozen cases of a dataset')
    .requiredOption('--dataset-id <id>', 'Dataset ID')
    .requiredOption('-m, --model <list>', 'Comma-separated provider/model targets (1–8)')
    .option('--case <ids>', 'Comma-separated test case IDs (default: every frozen case)')
    .option('--judge-model <model>', 'Judge model as provider/model (default: system agent)')
    .option('--name <name>', 'Run name')
    .option('--max-tokens <n>', 'Override max output tokens')
    .option('--temperature <n>', 'Override temperature')
    .option('--no-tools', 'Drop the recorded tool definitions from replayed calls')
    .option('--wait', 'Poll until every cell has finished, then print the grid')
    .option('--timeout <seconds>', 'Give up waiting after this many seconds', '600')
    .option('--json', 'Output JSON envelope')
    .action(
      async (
        options: JsonOption & {
          case?: string;
          datasetId: string;
          judgeModel?: string;
          maxTokens?: string;
          model: string;
          name?: string;
          temperature?: string;
          timeout: string;
          tools: boolean;
          wait?: boolean;
        },
      ) =>
        executeCommand(options, async () => {
          const targets = parseModelTargets(options.model).map(({ model, provider }) => ({
            model,
            provider,
          }));
          const judge = options.judgeModel ? parseModelTargets(options.judgeModel)[0] : undefined;

          const client = await getTrpcClient();
          const started = await client.agentEval.startReplayComparison.mutate({
            datasetId: options.datasetId,
            judge: judge && { model: judge.model, provider: judge.provider },
            name: options.name,
            replayOptions: {
              maxTokens: options.maxTokens ? Number.parseInt(options.maxTokens, 10) : undefined,
              temperature: options.temperature ? Number(options.temperature) : undefined,
              withTools: options.tools,
            },
            targets,
            testCaseIds: options.case
              ?.split(',')
              .map((id) => id.trim())
              .filter(Boolean),
          });

          if (!options.wait) return started;

          const comparison = await waitForComparison(
            started.runId,
            Number.parseInt(options.timeout, 10) * 1000,
          );
          if (!options.json) {
            printComparison(comparison);
            return undefined;
          }
          return comparison;
        }),
    );

  compareCmd
    .command('show')
    .description('Show the model × case grid of a comparison run')
    .requiredOption('--run-id <id>', 'Comparison run ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { runId: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        const comparison = await client.agentEval.getReplayComparison.query({
          runId: options.runId,
        });
        if (options.json) return comparison;
        printComparison(comparison);
        return undefined;
      }),
    );

  compareCmd
    .command('retry')
    .description('Re-run the errored cells of a comparison')
    .requiredOption('--run-id <id>', 'Comparison run ID')
    .option('--json', 'Output JSON envelope')
    .action(async (options: JsonOption & { runId: string }) =>
      executeCommand(options, async () => {
        const client = await getTrpcClient();
        return client.agentEval.retryReplayComparisonErrors.mutate({ runId: options.runId });
      }),
    );
}
