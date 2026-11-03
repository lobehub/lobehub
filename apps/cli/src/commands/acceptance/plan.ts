import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { outputJson, printTable, timeAgo, truncate } from '../../utils/format';
import { printResults } from './utils';

/** `plan` — the per-run check plan lifecycle of an Agent Run's acceptance round. */
export function attachPlanCommands(parent: Command): Command {
  const plan = parent.command('plan').description('Per-run check plan lifecycle');

  plan
    .command('generate <operationId>')
    .description('Generate a draft check plan for a run')
    .requiredOption('--goal <goal>', "The run's task/instruction the plan must satisfy")
    .option('--rubric <id>', 'Mounted rubric id')
    .option('--criteria <ids>', 'Ad-hoc criterion ids (comma-separated)')
    .option('--ai', 'Let the LLM propose additional criteria')
    .option('--max-ai <n>', 'Max AI-proposed criteria')
    .option('--context <text>', 'Extra context for the AI prompt')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        operationId: string,
        options: {
          ai?: boolean;
          context?: string;
          criteria?: string;
          goal: string;
          json?: boolean | string;
          maxAi?: string;
          rubric?: string;
        },
      ) => {
        const client = await getTrpcClient();
        const items = await client.verify.generateDraftPlan.mutate({
          context: options.context,
          enableAiGeneration: options.ai,
          goal: options.goal,
          maxAiCriteria: options.maxAi ? Number.parseInt(options.maxAi, 10) : undefined,
          operationId,
          verifyCriteriaIds: options.criteria
            ?.split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          verifyRubricId: options.rubric ?? null,
        });
        if (options.json !== undefined) {
          outputJson(items, typeof options.json === 'string' ? options.json : undefined);
          return;
        }
        console.log(`${pc.green('✓')} Draft plan: ${pc.bold(String(items.length))} item(s)`);
        printTable(
          items.map((i: any) => [
            String(i.index),
            truncate(i.title, 60),
            i.verifierType,
            i.required ? 'gate' : 'soft',
          ]),
          ['#', 'TITLE', 'TYPE', 'BLOCK'],
        );
      },
    );

  plan
    .command('state <operationId>')
    .description('Show the verify state (status + frozen plan) of a run')
    .option('--json [fields]', 'Output JSON')
    .action(async (operationId: string, options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const state = await client.verify.getVerifyState.query({ operationId });
      if (options.json !== undefined) {
        outputJson(state, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (!state) return void console.log('No verify state for this run.');
      console.log(`${pc.bold('status')}: ${state.verifyStatus ?? pc.dim('(none)')}`);
      console.log(
        `${pc.bold('confirmed')}: ${state.verifyPlanConfirmedAt ? timeAgo(state.verifyPlanConfirmedAt) : pc.dim('no')}`,
      );
      const items = (state.verifyPlan ?? []) as any[];
      console.log(`${pc.bold('plan')}: ${items.length} item(s)`);
      if (items.length > 0)
        printTable(
          items.map((i) => [
            String(i.index),
            truncate(i.title, 60),
            i.verifierType,
            i.required ? 'gate' : 'soft',
          ]),
          ['#', 'TITLE', 'TYPE', 'BLOCK'],
        );
    });

  plan
    .command('confirm <operationId>')
    .description('Freeze (confirm) the draft plan')
    .action(async (operationId: string) => {
      const client = await getTrpcClient();
      await client.verify.confirmPlan.mutate({ operationId });
      console.log(`${pc.green('✓')} Confirmed plan for run ${pc.bold(operationId)}`);
    });

  plan
    .command('skip <operationId>')
    .description('Skip verification for a run')
    .action(async (operationId: string) => {
      const client = await getTrpcClient();
      await client.verify.skipPlan.mutate({ operationId });
      console.log(`${pc.green('✓')} Skipped verification for run ${pc.bold(operationId)}`);
    });

  attachPlanExecuteCommand(plan.command('execute <operationId>'));
  return plan;
}

/** Execute the confirmed plan against a deliverable (LLM judge). */
export function attachPlanExecuteCommand(command: Command): Command {
  return command
    .description('Execute the confirmed plan against a deliverable (LLM judge)')
    .requiredOption('--goal <goal>', "The run's task")
    .requiredOption('--deliverable <text>', 'The output to judge')
    .requiredOption('--model <model>', 'Judge model')
    .requiredOption('--provider <provider>', 'Judge provider')
    .option('--no-batch', 'Judge each item separately instead of one batched call')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        operationId: string,
        options: {
          batch?: boolean;
          deliverable: string;
          goal: string;
          json?: boolean | string;
          model: string;
          provider: string;
        },
      ) => {
        const client = await getTrpcClient();
        const results = await client.verify.executeVerify.mutate({
          batchLlm: options.batch,
          deliverable: options.deliverable,
          goal: options.goal,
          modelConfig: { model: options.model, provider: options.provider },
          operationId,
        });
        if (options.json !== undefined) {
          outputJson(results, typeof options.json === 'string' ? options.json : undefined);
          return;
        }
        printResults(results);
      },
    );
}
