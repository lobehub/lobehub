import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

/**
 * Rewrite an existing goal's own configuration — the limits it runs under and the
 * acceptance bar it is judged against. Mirrors the server's grouping of the same
 * mutations (`routers/lambda/goal/configuration.ts`), and lives outside `index.ts`
 * because that file is already past the size limit.
 */
export const registerGoalConfigurationCommands = (goal: Command) => {
  goal
    .command('set-budget <id>')
    .description(
      'Update limits; --max-rounds, --max-cost, --max-concurrent-tasks and --max-steps-per-run also accept "none" to remove that limit',
    )
    .option('--max-rounds <n>')
    .option('--max-cost <usd>')
    .option('--max-experiments <n>', 'Exploration experiment cap (1–200)')
    .option(
      '--max-manager-turns <n>',
      'Main Agent turn cap (1–100); raising it resumes a goal it paused',
    )
    .option(
      '--max-concurrent-tasks <n>',
      'Tasks allowed to run at once (1–10; "none" restores the default)',
    )
    .option('--max-attempts-per-task <n>', 'Attempts per Task before opening a decision gate')
    .option('--max-steps-per-run <n>', 'Agent step cap per Task run ("none" removes it)')
    .action(
      async (
        id: string,
        options: {
          maxAttemptsPerTask?: string;
          maxConcurrentTasks?: string;
          maxCost?: string;
          maxExperiments?: string;
          maxManagerTurns?: string;
          maxRounds?: string;
          maxStepsPerRun?: string;
        },
      ) => {
        const parseLimit = (value: string | undefined, integer = false) =>
          value === undefined
            ? undefined
            : value === 'none'
              ? null
              : integer
                ? Number.parseInt(value, 10)
                : Number.parseFloat(value);
        const result = await (
          await getTrpcClient()
        ).goal.setBudget.mutate({
          id,
          maxAttemptsPerTask:
            options.maxAttemptsPerTask === undefined
              ? undefined
              : Number.parseInt(options.maxAttemptsPerTask, 10),
          maxConcurrentTasks: parseLimit(options.maxConcurrentTasks, true),
          maxExperiments:
            options.maxExperiments === undefined ? undefined : Number(options.maxExperiments),
          maxManagerTurns:
            options.maxManagerTurns === undefined
              ? undefined
              : Number.parseInt(options.maxManagerTurns, 10),
          maxRounds: parseLimit(options.maxRounds, true),
          maxStepsPerRun: parseLimit(options.maxStepsPerRun, true),
          maxTotalCost: parseLimit(options.maxCost),
        });
        log.info(result.message);
      },
    );

  goal
    .command('set-requirement <id>')
    .description(
      "Replace the goal's requirement — the acceptance bar its tasks and terminal review read",
    )
    .option('-r, --requirement <text>', 'New requirement text')
    .option(
      '-f, --file <path>',
      'Read the requirement from a file — use this for the long, multi-line document the goal page holds',
    )
    .action(async (id: string, options: { file?: string; requirement?: string }) => {
      // These are alternatives, not a precedence order: a caller that passed both
      // meant one of them, and silently picking one would rewrite the goal's
      // acceptance bar on a guess.
      if (options.file && options.requirement !== undefined) {
        throw new Error('Pass either --requirement <text> or --file <path>, not both');
      }
      const requirement = (
        options.file ? await readFile(options.file, 'utf8') : (options.requirement ?? '')
      ).trim();
      if (!requirement) {
        throw new Error('Provide the requirement with --requirement <text> or --file <path>');
      }
      const result = await (
        await getTrpcClient()
      ).goal.updateRequirement.mutate({ id, requirement });
      log.info(`Updated the requirement of goal ${result.data.id}`);
    });
};
