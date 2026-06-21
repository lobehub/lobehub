import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { uploadLocalFile } from '../utils/uploadLocalFile';

// ── Helpers ────────────────────────────────────────────────

type VerifierType = 'agent' | 'llm' | 'program';
type OnFail = 'auto_repair' | 'manual';
type Decision = 'accepted' | 'overridden' | 'rejected';

const VERIFIER_TYPES: VerifierType[] = ['program', 'agent', 'llm'];
const ON_FAIL: OnFail[] = ['manual', 'auto_repair'];
const DECISIONS: Decision[] = ['accepted', 'rejected', 'overridden'];

function parseConfig(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    log.error('--config must be valid JSON');
    process.exit(1);
  }
}

function assertEnum<T extends string>(value: T | undefined, allowed: T[], flag: string): void {
  if (value !== undefined && !allowed.includes(value)) {
    log.error(`${flag} must be one of: ${allowed.join(', ')}`);
    process.exit(1);
  }
}

type Verdict = 'failed' | 'passed' | 'uncertain';
type EvidenceType = 'dom_snapshot' | 'gif' | 'screenshot' | 'text' | 'transcript' | 'video';

/** Map a free-form case/summary result token onto the verify verdict vocabulary. */
function toVerdict(raw: unknown): Verdict {
  const s = String(raw ?? '').toLowerCase();
  if (['pass', 'passed', 'ok', 'success'].includes(s)) return 'passed';
  if (['fail', 'failed', 'error'].includes(s)) return 'failed';
  return 'uncertain'; // partial / blocked / skipped / pending / unknown
}

/** Pick an evidence medium from a file extension. */
function evidenceTypeForFile(file: string): EvidenceType {
  const ext = path.extname(file).toLowerCase().slice(1);
  if (ext === 'gif') return 'gif';
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp'].includes(ext)) return 'screenshot';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['html', 'htm'].includes(ext)) return 'dom_snapshot';
  return 'text';
}

/** Normalize a case's `evidence` field (string | string[] | {path}[]) to path strings. */
function evidencePaths(evidence: unknown): string[] {
  if (!evidence) return [];
  const arr = Array.isArray(evidence) ? evidence : [evidence];
  return arr
    .map((e) => (typeof e === 'string' ? e : (e?.path ?? e?.file)))
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
}

// ── Command Registration ───────────────────────────────────

export function registerVerifyCommand(program: Command) {
  const verify = program
    .command('verify')
    .description('Manage the Agent Run delivery checker (criteria, rubrics, plans, results)');

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

  // ════════════ run (verification session entity) ════════════
  const run = verify.command('run').description('Verification sessions (verify_runs)');

  run
    .command('create')
    .description('Create a standalone verification session')
    .option('--source <source>', 'agent | agent-testing', 'agent-testing')
    .option('--operation <id>', 'Link to an existing Agent Run')
    .option('--title <title>', 'Session title')
    .option('--goal <goal>', 'Goal/task being verified')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        goal?: string;
        json?: boolean | string;
        operation?: string;
        source?: string;
        title?: string;
      }) => {
        const client = await getTrpcClient();
        const created = await client.verify.createRun.mutate({
          goal: options.goal,
          operationId: options.operation,
          source: options.source as any,
          title: options.title,
        });
        if (options.json !== undefined) {
          outputJson(created, typeof options.json === 'string' ? options.json : undefined);
          return;
        }
        console.log(`${pc.green('✓')} Created run ${pc.bold(created.id)}`);
      },
    );

  run
    .command('list')
    .description('List recent verification sessions')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const runs = await client.verify.listRuns.query();
      if (options.json !== undefined) {
        outputJson(runs, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (runs.length === 0) return void console.log('No runs found.');
      printTable(
        runs.map((r: any) => [
          r.id,
          truncate(r.title || '', 40),
          r.source,
          r.status ?? '',
          r.operationId ? 'agent' : 'standalone',
          r.createdAt ? timeAgo(r.createdAt) : '',
        ]),
        ['ID', 'TITLE', 'SOURCE', 'STATUS', 'KIND', 'CREATED'],
      );
    });

  run
    .command('get <runId>')
    .description('Show a verification session')
    .option('--json [fields]', 'Output JSON')
    .action(async (runId: string, options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const item = await client.verify.getRun.query({ verifyRunId: runId });
      if (options.json !== undefined) {
        outputJson(item, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (!item) return void console.log('Run not found.');
      console.log(JSON.stringify(item, null, 2));
    });

  // ════════════ result (check result entity) ════════════
  const result = verify.command('result').description('Check results (verify_check_results)');

  result
    .command('ingest')
    .description('Upsert one check result by (run, checkItemId) from a supplied verdict')
    .requiredOption('--run <verifyRunId>', 'Target session id')
    .requiredOption('--check <checkItemId>', 'Stable check item id within the session')
    .requiredOption('--verdict <verdict>', 'passed|failed|uncertain')
    .option('--title <title>', 'Check title')
    .option('--index <n>', 'Display index')
    .option('--confidence <n>', '0-1 confidence')
    .option('--status <status>', 'pending|running|passed|failed|skipped (derived from verdict)')
    .option('--evidence <text>', 'Key observation (stored as Toulmin evidence)')
    .option('--suggestion <text>', 'Remediation hint')
    .option('--soft', 'Non-blocking (required=false); defaults to blocking')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        check: string;
        confidence?: string;
        evidence?: string;
        index?: string;
        json?: boolean | string;
        run: string;
        soft?: boolean;
        status?: string;
        suggestion?: string;
        title?: string;
        verdict: string;
      }) => {
        const client = await getTrpcClient();
        const created = await client.verify.ingestResult.mutate({
          checkItemId: options.check,
          checkItemIndex: options.index ? Number.parseInt(options.index, 10) : undefined,
          checkItemTitle: options.title,
          confidence: options.confidence ? Number.parseFloat(options.confidence) : undefined,
          required: options.soft ? false : undefined,
          status: options.status as any,
          suggestion: options.suggestion,
          toulmin: options.evidence ? { evidence: options.evidence } : undefined,
          verdict: options.verdict as any,
          verifyRunId: options.run,
        });
        if (options.json !== undefined) {
          outputJson(created, typeof options.json === 'string' ? options.json : undefined);
          return;
        }
        console.log(`${pc.green('✓')} Result ${pc.bold(created.id)} (${created.verdict})`);
      },
    );

  result
    .command('list')
    .description('List check results — by session (--run) or by Agent Run (--operation)')
    .option('--run <verifyRunId>', 'List by verification session')
    .option('--operation <operationId>', 'List by Agent Run')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; operation?: string; run?: string }) => {
      if (!options.run && !options.operation) {
        log.error('Provide either --run or --operation');
        process.exit(1);
      }
      const client = await getTrpcClient();
      const results = options.run
        ? await client.verify.listResultsByRun.query({ verifyRunId: options.run })
        : await client.verify.listResults.query({ operationId: options.operation! });
      if (options.json !== undefined) {
        outputJson(results, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (results.length === 0) return void console.log('No results yet.');
      printResults(results);
    });

  // ════════════ evidence (artifact entity) ════════════
  const evidence = verify.command('evidence').description('Evidence artifacts (verify_evidence)');

  evidence
    .command('upload')
    .description('Attach an evidence artifact (file or inline text) to a check result')
    .requiredOption('--check <checkResultId>', 'Target check result id')
    .requiredOption('--type <type>', 'screenshot|gif|video|text|dom_snapshot|transcript')
    .option('--file <path>', 'Local file to upload as the artifact')
    .option('--content <text>', 'Inline text payload (instead of a file)')
    .option('--by <capturedBy>', 'agent-browser|cdp|cli|program|llm_judge', 'cli')
    .option('--desc <text>', 'Human-readable caption')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        by?: string;
        check: string;
        content?: string;
        desc?: string;
        file?: string;
        json?: boolean | string;
        type: string;
      }) => {
        if (Boolean(options.file) === Boolean(options.content)) {
          log.error('Provide exactly one of --file or --content');
          process.exit(1);
        }
        const client = await getTrpcClient();
        let fileId: string | undefined;
        if (options.file) {
          const uploaded = await uploadLocalFile(client, options.file);
          fileId = uploaded.id;
        }
        const ev = await client.verify.uploadEvidence.mutate({
          capturedBy: options.by as any,
          checkResultId: options.check,
          content: options.content,
          description: options.desc,
          fileId,
          type: options.type as any,
        });
        if (options.json !== undefined) {
          outputJson(ev, typeof options.json === 'string' ? options.json : undefined);
          return;
        }
        console.log(
          `${pc.green('✓')} Evidence ${pc.bold(ev.id)}${fileId ? ` (file ${fileId})` : ''}`,
        );
      },
    );

  evidence
    .command('list <checkResultId>')
    .description('List evidence for a check result')
    .option('--json [fields]', 'Output JSON')
    .action(async (checkResultId: string, options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const rows = await client.verify.listEvidence.query({ checkResultId });
      if (options.json !== undefined) {
        outputJson(rows, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (rows.length === 0) return void console.log('No evidence.');
      printTable(
        rows.map((e: any) => [
          e.id,
          e.type,
          e.capturedBy ?? '',
          e.fileId ? 'file' : 'inline',
          truncate(e.description || '', 40),
        ]),
        ['ID', 'TYPE', 'BY', 'PAYLOAD', 'DESC'],
      );
    });

  // ════════════ report (narrative entity) ════════════
  const report = verify.command('report').description('Verification reports (verify_reports)');

  report
    .command('upsert')
    .description('Write (overwrite) the report for a session')
    .requiredOption('--run <verifyRunId>', 'Target session id')
    .option('--verdict <verdict>', 'passed|failed|uncertain')
    .option('--summary <text>', 'Short summary')
    .option('--content <markdown>', 'Full markdown body')
    .option('--total <n>', 'Total checks')
    .option('--passed <n>', 'Passed checks')
    .option('--failed <n>', 'Failed checks')
    .option('--uncertain <n>', 'Uncertain checks')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        content?: string;
        failed?: string;
        json?: boolean | string;
        passed?: string;
        run: string;
        summary?: string;
        total?: string;
        uncertain?: string;
        verdict?: string;
      }) => {
        const num = (s?: string) => (s === undefined ? undefined : Number.parseInt(s, 10));
        const client = await getTrpcClient();
        const created = await client.verify.upsertReport.mutate({
          content: options.content,
          failedChecks: num(options.failed),
          passedChecks: num(options.passed),
          summary: options.summary,
          totalChecks: num(options.total),
          uncertainChecks: num(options.uncertain),
          verdict: options.verdict as any,
          verifyRunId: options.run,
        });
        if (options.json !== undefined) {
          outputJson(created, typeof options.json === 'string' ? options.json : undefined);
          return;
        }
        console.log(`${pc.green('✓')} Report ${pc.bold(created.id)} (${created.verdict ?? '—'})`);
      },
    );

  report
    .command('get <runId>')
    .description('Show the report for a session')
    .option('--json [fields]', 'Output JSON')
    .action(async (runId: string, options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const item = await client.verify.getReport.query({ verifyRunId: runId });
      if (options.json !== undefined) {
        outputJson(item, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (!item) return void console.log('No report.');
      console.log(JSON.stringify(item, null, 2));
    });

  // ════════════ feedback ════════════
  verify
    .command('decision <resultId> <decision>')
    .description(`Record human feedback on a result (${DECISIONS.join('|')})`)
    .action(async (resultId: string, decision: Decision) => {
      assertEnum(decision, DECISIONS, 'decision');
      const client = await getTrpcClient();
      await client.verify.submitDecision.mutate({ decision, resultId });
      console.log(`${pc.green('✓')} Recorded ${pc.bold(decision)} on result ${pc.bold(resultId)}`);
    });

  // ════════════ ingest (aggregate convenience over the atomic commands) ════════════
  verify
    .command('ingest-report <reportDir>')
    .description(
      'Ingest a local agent-testing report (result.json + report.md + assets) as a verify session',
    )
    .option('--source <source>', 'agent | agent-testing', 'agent-testing')
    .option('--operation <id>', 'Link the session to an existing Agent Run')
    .option('--title <title>', 'Override the session title')
    .option('--goal <goal>', 'The goal/task being verified')
    .option('--open', 'Print the in-app URL to open the report')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        reportDir: string,
        options: {
          goal?: string;
          json?: boolean | string;
          open?: boolean;
          operation?: string;
          source?: string;
          title?: string;
        },
      ) => {
        const dir = path.resolve(reportDir);
        const resultPath = path.join(dir, 'result.json');
        if (!existsSync(resultPath)) {
          log.error(`result.json not found in ${dir}`);
          process.exit(1);
        }

        let result: any;
        try {
          result = JSON.parse(readFileSync(resultPath, 'utf8'));
        } catch {
          log.error('result.json is not valid JSON');
          process.exit(1);
        }

        const cases: any[] = Array.isArray(result.cases) ? result.cases : [];
        const summary = result.summary ?? {};
        const reportMdPath = path.join(dir, 'report.md');
        const content = existsSync(reportMdPath) ? readFileSync(reportMdPath, 'utf8') : undefined;

        const client = await getTrpcClient();

        // 1. Create the verification session.
        const run = await client.verify.createRun.mutate({
          goal: options.goal,
          operationId: options.operation,
          source: options.source as any,
          title: options.title ?? result.title,
        });

        // 2. Ingest each case as a check result + its evidence.
        let uploaded = 0;
        for (const [index, c] of cases.entries()) {
          const checkItemId = String(c.id ?? c.checkItemId ?? `case-${index + 1}`);
          const verdict = toVerdict(c.result ?? c.status ?? c.verdict);
          const observation = c.keyObservation ?? c.observation ?? c.note;
          const checkResult = await client.verify.ingestResult.mutate({
            checkItemId,
            checkItemIndex: index,
            checkItemTitle: c.name ?? c.case ?? c.title ?? checkItemId,
            required: c.required ?? true,
            // The case's key observation is recorded as Toulmin evidence; a real
            // remediation hint (if the report provides one) goes to `suggestion`.
            suggestion: typeof c.suggestion === 'string' ? c.suggestion : undefined,
            toulmin: typeof observation === 'string' ? { evidence: observation } : undefined,
            verdict,
            verifierType: 'agent',
            verifyRunId: run.id,
          });

          for (const rel of evidencePaths(c.evidence)) {
            const abs = path.isAbsolute(rel) ? rel : path.join(dir, rel);
            if (!existsSync(abs)) {
              log.warn(`evidence not found, skipping: ${rel}`);
              continue;
            }
            const file = await uploadLocalFile(client, abs);
            await client.verify.uploadEvidence.mutate({
              capturedBy: 'cli',
              checkResultId: checkResult.id,
              description: c.name ?? path.basename(abs),
              fileId: file.id,
              type: evidenceTypeForFile(abs),
            });
            uploaded += 1;
          }
        }

        // 3. Write the report (full markdown + stats snapshot).
        await client.verify.upsertReport.mutate({
          content,
          failedChecks: summary.failed,
          passedChecks: summary.passed,
          summary: typeof summary.note === 'string' ? summary.note : undefined,
          totalChecks: summary.total ?? cases.length,
          uncertainChecks: (summary.blocked ?? 0) + (summary.uncertain ?? 0) || undefined,
          verdict: summary.verdict ? toVerdict(summary.verdict) : undefined,
          verifyRunId: run.id,
        });

        if (options.json !== undefined) {
          outputJson(
            { cases: cases.length, evidence: uploaded, verifyRunId: run.id },
            typeof options.json === 'string' ? options.json : undefined,
          );
          return;
        }

        console.log(
          `${pc.green('✓')} Ingested ${pc.bold(String(cases.length))} case(s), ${pc.bold(String(uploaded))} evidence file(s)`,
        );
        console.log(`${pc.bold('verifyRunId')}: ${run.id}`);
        if (options.open) {
          console.log(`${pc.bold('open')}: /verify/${run.id}`);
        }
      },
    );
}

function printResults(results: any[]): void {
  printTable(
    results.map((r) => [
      truncate(r.checkItemTitle || r.checkItemId, 50),
      statusColor(r.status),
      r.verdict ?? '',
      r.confidence != null ? String(r.confidence) : '',
      r.required ? 'gate' : 'soft',
      truncate(r.suggestion || '', 40),
    ]),
    ['CHECK', 'STATUS', 'VERDICT', 'CONF', 'BLOCK', 'SUGGESTION'],
  );
}

function statusColor(status: string): string {
  if (status === 'passed') return pc.green(status);
  if (status === 'failed') return pc.red(status);
  if (status === 'running') return pc.yellow(status);
  return pc.dim(status);
}
