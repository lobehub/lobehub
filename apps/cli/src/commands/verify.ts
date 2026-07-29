import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { attachDeprecatedVerifyRunAliases } from './acceptanceRun';
import { registerAcceptanceCommands } from './verifyAcceptance';
import {
  assertEnum,
  ON_FAIL,
  type OnFail,
  parseConfig,
  printResults,
  VERIFIER_TYPES,
  type VerifierType,
} from './verifyHelpers';

// Re-export the report/ingest helpers so existing importers keep resolving them
// from './verify' (tests, and callers predating the verifyHelpers split).
export * from './verifyHelpers';

// ── Command Registration ───────────────────────────────────

export function registerVerifyCommand(program: Command) {
  const verify = program
    .command('verify')
    .description('Agent Run verification machinery — criteria, rubrics, and per-run check plans');

  // `verify acceptance …` — legacy alias; the canonical group is the first-class
  // `lh acceptance`.
  registerAcceptanceCommands(verify, { deprecated: true });

  // Deprecated `lh verify …` spellings for the run/result/evidence/report/install
  // commands now living under `lh acceptance`. Kept for a few releases.
  attachDeprecatedVerifyRunAliases(verify);
  // ════════════ criteria ════════════
  const criterion = verify.command('criterion').description('Reusable pass/fail standards');

  criterion
    .command('list')
    .description('List criteria')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const items = await client.verify.listCriteria.query();

      if (options.json !== undefined) {
        outputJson(items, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (items.length === 0) return void console.log('No criteria found.');
      printTable(
        items.map((c) => [
          c.id,
          truncate(c.title, 60),
          c.verifierType,
          c.required ? 'gate' : 'soft',
          c.onFail,
          c.updatedAt ? timeAgo(c.updatedAt) : '',
        ]),
        ['ID', 'TITLE', 'TYPE', 'BLOCK', 'ON-FAIL', 'UPDATED'],
      );
    });

  criterion
    .command('create')
    .description('Create a criterion')
    .requiredOption('-t, --title <title>', 'Criterion title')
    .requiredOption('--type <type>', `Verifier type (${VERIFIER_TYPES.join('|')})`)
    .option('--on-fail <strategy>', `Action on failure (${ON_FAIL.join('|')})`)
    .option('--soft', 'Non-blocking (required=false); defaults to blocking')
    .option('--config <json>', 'Verifier config as JSON')
    .option('--doc <id>', 'Linked guidance document id')
    .action(
      async (options: {
        config?: string;
        doc?: string;
        onFail?: OnFail;
        soft?: boolean;
        title: string;
        type: VerifierType;
      }) => {
        assertEnum(options.type, VERIFIER_TYPES, '--type');
        assertEnum(options.onFail, ON_FAIL, '--on-fail');
        const client = await getTrpcClient();
        const result = await client.verify.createCriterion.mutate({
          documentId: options.doc,
          onFail: options.onFail,
          required: options.soft ? false : undefined,
          title: options.title,
          verifierConfig: parseConfig(options.config),
          verifierType: options.type,
        });
        console.log(`${pc.green('✓')} Created criterion ${pc.bold((result as any).id)}`);
      },
    );

  criterion
    .command('delete <id>')
    .description('Delete a criterion')
    .option('--yes', 'Skip confirmation')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes && !(await confirm(`Delete criterion ${id}?`)))
        return void console.log('Cancelled.');
      const client = await getTrpcClient();
      await client.verify.deleteCriterion.mutate({ id });
      console.log(`${pc.green('✓')} Deleted criterion ${pc.bold(id)}`);
    });

  // ════════════ rubrics ════════════
  const rubric = verify.command('rubric').description('Named groups of criteria');

  rubric
    .command('list')
    .description('List rubrics')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const items = await client.verify.listRubrics.query();
      if (options.json !== undefined) {
        outputJson(items, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (items.length === 0) return void console.log('No rubrics found.');
      printTable(
        items.map((r) => [
          r.id,
          truncate(r.title, 60),
          truncate(r.description || '', 60),
          r.updatedAt ? timeAgo(r.updatedAt) : '',
        ]),
        ['ID', 'TITLE', 'DESCRIPTION', 'UPDATED'],
      );
    });

  rubric
    .command('create')
    .description('Create a rubric')
    .requiredOption('-t, --title <title>', 'Rubric title')
    .option('-d, --description <text>', 'Rubric description')
    .option('--max-repair-rounds <n>', 'Cap on automatic repair rounds (0-5)')
    .action(async (options: { description?: string; maxRepairRounds?: string; title: string }) => {
      const client = await getTrpcClient();
      const result = await client.verify.createRubric.mutate({
        config:
          options.maxRepairRounds !== undefined
            ? { maxRepairRounds: Number(options.maxRepairRounds) }
            : undefined,
        description: options.description,
        title: options.title,
      });
      console.log(`${pc.green('✓')} Created rubric ${pc.bold((result as any).id)}`);
    });

  rubric
    .command('view <id>')
    .description('Show a rubric and its run-policy config')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const item = await client.verify.getRubric.query({ id });
      if (!item) return void log.error('Rubric not found.');
      if (options.json !== undefined) {
        outputJson(item, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      console.log(`${pc.bold('ID')}            ${item.id}`);
      console.log(`${pc.bold('Title')}         ${item.title}`);
      if (item.description) console.log(`${pc.bold('Description')}   ${item.description}`);
      const maxRepairRounds = (item.config as { maxRepairRounds?: number } | null)?.maxRepairRounds;
      console.log(`${pc.bold('Repair rounds')} ${maxRepairRounds ?? pc.dim('default')}`);
    });

  rubric
    .command('update <id>')
    .description('Update a rubric (title / description / run-policy config)')
    .option('-t, --title <title>', 'New title')
    .option('-d, --description <text>', 'New description')
    .option('--max-repair-rounds <n>', 'Cap on automatic repair rounds (0-5)')
    .action(
      async (
        id: string,
        options: { description?: string; maxRepairRounds?: string; title?: string },
      ) => {
        const client = await getTrpcClient();
        const value: {
          config?: { maxRepairRounds?: number };
          description?: string;
          title?: string;
        } = {};
        if (options.title !== undefined) value.title = options.title;
        if (options.description !== undefined) value.description = options.description;
        if (options.maxRepairRounds !== undefined)
          value.config = { maxRepairRounds: Number(options.maxRepairRounds) };
        await client.verify.updateRubric.mutate({ id, value });
        console.log(`${pc.green('✓')} Updated rubric ${pc.bold(id)}`);
      },
    );

  rubric
    .command('delete <id>')
    .description('Delete a rubric')
    .option('--yes', 'Skip confirmation')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes && !(await confirm(`Delete rubric ${id}?`)))
        return void console.log('Cancelled.');
      const client = await getTrpcClient();
      await client.verify.deleteRubric.mutate({ id });
      console.log(`${pc.green('✓')} Deleted rubric ${pc.bold(id)}`);
    });

  rubric
    .command('criteria <rubricId>')
    .description('List criteria in a rubric')
    .option('--json [fields]', 'Output JSON')
    .action(async (rubricId: string, options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const items = await client.verify.getRubricCriteria.query({ rubricId });
      if (options.json !== undefined) {
        outputJson(items, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (items.length === 0) return void console.log('No criteria in this rubric.');
      printTable(
        items.map((c: any) => [
          c.id,
          truncate(c.title, 60),
          c.verifierType,
          c.required ? 'gate' : 'soft',
        ]),
        ['ID', 'TITLE', 'TYPE', 'BLOCK'],
      );
    });

  rubric
    .command('set-criteria <rubricId> <criterionIds...>')
    .description('Set the criteria a rubric aggregates (order preserved)')
    .action(async (rubricId: string, criterionIds: string[]) => {
      const client = await getTrpcClient();
      await client.verify.setRubricCriteria.mutate({
        criteria: criterionIds.map((criterionId, i) => ({ criterionId, sortOrder: i })),
        rubricId,
      });
      console.log(
        `${pc.green('✓')} Rubric ${pc.bold(rubricId)} now has ${criterionIds.length} criterion(s)`,
      );
    });

  // ════════════ per-run plan ════════════
  const plan = verify.command('plan').description('Per-run check plan lifecycle');

  plan
    .command('generate <operationId>')
    .description('Generate a draft check plan for a run')
    .requiredOption('--goal <goal>', "The run's task/instruction the plan must satisfy")
    .option('--rubric <id>', 'Mounted rubric id')
    .option('--criteria <ids>', 'Ad-hoc criterion ids (comma-separated)')
    .option('--ai', 'Let the LLM propose additional criteria')
    .option('--max-ai <n>', 'Max AI-proposed criteria')
    .option('--model <model>', 'Model (required with --ai)')
    .option('--provider <provider>', 'Provider (required with --ai)')
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
          model?: string;
          provider?: string;
          rubric?: string;
        },
      ) => {
        if (options.ai && (!options.model || !options.provider)) {
          log.error('--ai requires --model and --provider');
          process.exit(1);
        }
        const client = await getTrpcClient();
        const items = await client.verify.generateDraftPlan.mutate({
          context: options.context,
          enableAiGeneration: options.ai,
          goal: options.goal,
          maxAiCriteria: options.maxAi ? Number.parseInt(options.maxAi, 10) : undefined,
          modelConfig:
            options.model && options.provider
              ? { model: options.model, provider: options.provider }
              : undefined,
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

  // ════════════ execute (agent path) ════════════
  verify
    .command('execute <operationId>')
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
