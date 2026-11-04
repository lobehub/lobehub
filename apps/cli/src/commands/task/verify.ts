import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';
import { resolveUrlBuilder, resourcePath, withUrl } from '../resourceUrl';
import { readFlag } from './model';

export interface TaskVerifyOptions {
  criteria?: string;
  disable?: boolean;
  enable?: boolean;
  maxIterations?: string;
  requirement?: string;
  rubric?: string;
  verifier?: string;
}

/** Only explicit flags are sent; `null` / `none` clears a saved value. */
export const toVerifyPatch = (options: TaskVerifyOptions) => {
  if (options.enable && options.disable) {
    throw new Error('--enable and --disable cannot be used together');
  }

  const patch: {
    enabled?: boolean;
    maxIterations?: number | null;
    requirement?: string | null;
    verifierAgentId?: string | null;
    verifyCriteriaIds?: string[] | null;
    verifyRubricId?: string | null;
  } = {};
  if (options.enable) patch.enabled = true;
  if (options.disable) patch.enabled = false;

  const requirement = readFlag(options.requirement);
  if (requirement !== undefined) patch.requirement = requirement;
  const verifier = readFlag(options.verifier);
  if (verifier !== undefined) patch.verifierAgentId = verifier;
  const rubric = readFlag(options.rubric);
  if (rubric !== undefined) patch.verifyRubricId = rubric;

  const maxIterations = readFlag(options.maxIterations);
  if (maxIterations !== undefined) {
    if (maxIterations !== null && !/^\d+$/.test(maxIterations)) {
      throw new Error(`--max-iterations must be a positive integer, got "${maxIterations}"`);
    }
    patch.maxIterations = maxIterations === null ? null : Number.parseInt(maxIterations, 10);
  }

  const criteria = readFlag(options.criteria);
  if (criteria !== undefined) {
    patch.verifyCriteriaIds =
      criteria === null
        ? null
        : criteria
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
  }

  return patch;
};

export function registerVerifyCommands(task: Command) {
  // ── verify ──────────────────────────────────────────────

  const verify = task.command('verify').description('Manage task acceptance conditions');

  verify
    .command('view <id>')
    .description('View the acceptance conditions of a task')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const { data } = await client.task.getVerifyConfig.query({ id });

      if (options.json !== undefined) {
        outputJson(
          withUrl(data as object, await resolveUrlBuilder(client), resourcePath.task({ id })),
          options.json,
        );
        return;
      }

      if (!data) {
        log.info('Acceptance conditions not configured.');
        return;
      }

      console.log(`${pc.dim('Enabled:')} ${data.enabled !== false}`);
      if (data.requirement) console.log(`${pc.dim('Requirement:')} ${data.requirement}`);
      if (data.maxIterations) console.log(`${pc.dim('Max iterations:')} ${data.maxIterations}`);
      if (data.verifierAgentId) console.log(`${pc.dim('Verifier:')} ${data.verifierAgentId}`);
      if (data.verifyRubricId) console.log(`${pc.dim('Rubric:')} ${data.verifyRubricId}`);
      if (data.verifyCriteriaIds?.length) {
        console.log(`${pc.dim('Criteria:')} ${data.verifyCriteriaIds.join(', ')}`);
      }
    });

  verify
    .command('set <id>')
    .description('Update the acceptance conditions of a task')
    .option('--enable', 'Turn acceptance on')
    .option('--disable', 'Turn acceptance off')
    .option('--requirement <text>', 'What the delivery must satisfy ("null" to clear)')
    .option('--max-iterations <n>', 'Verification attempts, 1-10 ("null" to clear)')
    .option('--verifier <agentId>', 'Agent that verifies the delivery ("null" to clear)')
    .option('--rubric <id>', 'Rubric to verify against ("null" to clear)')
    .option('--criteria <ids>', 'Comma-separated criteria ids ("null" to clear)')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: TaskVerifyOptions & { json?: string | boolean }) => {
      const patch = toVerifyPatch(options);
      if (Object.keys(patch).length === 0) {
        log.error('Nothing to update. Pass at least one flag; see `lh task verify set --help`.');
        process.exitCode = 1;
        return;
      }

      const client = await getTrpcClient();
      const result = await client.task.updateVerifyConfig.mutate({ id, verify: patch });

      if (options.json !== undefined) {
        outputJson(
          withUrl(result.data, await resolveUrlBuilder(client), resourcePath.task({ id })),
          options.json,
        );
        return;
      }

      log.info(`Acceptance conditions updated for ${pc.bold(id)}.`);
    });
}
