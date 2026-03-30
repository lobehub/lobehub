import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { printTable, truncate } from '../../utils/format';
import { log } from '../../utils/logger';

export function registerReviewCommands(task: Command) {
  // ── review ──────────────────────────────────────────────

  const rv = task.command('review').description('Manage task review (LLM-as-Judge)');

  rv.command('view <id>')
    .description('View review config for a task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.getReview.query({ id });
      const r = result.data as any;

      if (!r || !r.enabled) {
        log.info('Review not configured for this task.');
        return;
      }

      console.log(`\n${pc.bold('Review config:')}`);
      console.log(`  enabled: ${r.enabled}`);
      if (r.judge?.model)
        console.log(`  judge: ${r.judge.model}${r.judge.provider ? ` (${r.judge.provider})` : ''}`);
      console.log(`  maxIterations: ${r.maxIterations}`);
      console.log(`  autoRetry: ${r.autoRetry}`);
      if (r.rubrics?.length > 0) {
        console.log(`  rubrics:`);
        for (let i = 0; i < r.rubrics.length; i++) {
          const rb = r.rubrics[i];
          const threshold = rb.threshold ? ` ≥ ${Math.round(rb.threshold * 100)}%` : '';
          const typeTag = pc.dim(`[${rb.type}]`);
          let configInfo = '';
          if (rb.type === 'llm-rubric') configInfo = rb.config?.criteria || '';
          else if (rb.type === 'contains' || rb.type === 'equals')
            configInfo = `value="${rb.config?.value}"`;
          else if (rb.type === 'regex') configInfo = `pattern="${rb.config?.pattern}"`;
          console.log(`    ${i + 1}. ${rb.name} ${typeTag}${threshold} ${pc.dim(configInfo)}`);
        }
      } else {
        console.log(`  rubrics: ${pc.dim('(none)')}`);
      }
      console.log();
    });

  rv.command('set <id>')
    .description('Enable review and configure judge settings')
    .option('--model <model>', 'Judge model')
    .option('--provider <provider>', 'Judge provider')
    .option('--max-iterations <n>', 'Max review iterations', '3')
    .option('--no-auto-retry', 'Disable auto retry on failure')
    .option('--recursive', 'Apply to all subtasks as well')
    .action(
      async (
        id: string,
        options: {
          autoRetry?: boolean;
          maxIterations?: string;
          model?: string;
          provider?: string;
          recursive?: boolean;
        },
      ) => {
        const client = await getTrpcClient();

        // Read current review config to preserve rubrics
        const current = (await client.task.getReview.query({ id })).data as any;
        const existingRubrics = current?.rubrics || [];

        const review = {
          autoRetry: options.autoRetry !== false,
          enabled: true,
          judge: {
            ...(options.model && { model: options.model }),
            ...(options.provider && { provider: options.provider }),
          },
          maxIterations: Number.parseInt(options.maxIterations || '3', 10),
          rubrics: existingRubrics,
        };

        await client.task.updateReview.mutate({ id, review });

        if (options.recursive) {
          const subtasks = await client.task.getSubtasks.query({ id });
          for (const s of subtasks.data || []) {
            const subCurrent = (await client.task.getReview.query({ id: s.id })).data as any;
            await client.task.updateReview.mutate({
              id: s.id,
              review: { ...review, rubrics: subCurrent?.rubrics || existingRubrics },
            });
          }
          log.info(
            `Review enabled for ${pc.bold(id)} + ${(subtasks.data || []).length} subtask(s).`,
          );
        } else {
          log.info('Review enabled.');
        }
      },
    );

  // ── review criteria ──────────────────────────────────────

  const rc = rv.command('criteria').description('Manage review rubrics');

  rc.command('list <id>')
    .description('List review rubrics for a task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.getReview.query({ id });
      const r = result.data as any;
      const rubrics = r?.rubrics || [];

      if (rubrics.length === 0) {
        log.info('No rubrics configured.');
        return;
      }

      const rows = rubrics.map((r: any, i: number) => {
        const config = r.config || {};
        const configStr =
          r.type === 'llm-rubric'
            ? config.criteria || ''
            : r.type === 'contains' || r.type === 'equals'
              ? `value: "${config.value}"`
              : r.type === 'regex'
                ? `pattern: "${config.pattern}"`
                : JSON.stringify(config);

        return [
          String(i + 1),
          r.name,
          r.type,
          r.threshold ? `≥ ${Math.round(r.threshold * 100)}%` : '-',
          String(r.weight ?? 1),
          truncate(configStr, 40),
        ];
      });

      printTable(rows, ['#', 'NAME', 'TYPE', 'THRESHOLD', 'WEIGHT', 'CONFIG']);
    });

  rc.command('add <id>')
    .description('Add a review rubric')
    .requiredOption('-n, --name <name>', 'Rubric name (e.g. "内容准确性")')
    .option('--type <type>', 'Rubric type (default: llm-rubric)', 'llm-rubric')
    .option('-t, --threshold <n>', 'Pass threshold 0-100 (converted to 0-1)')
    .option('-d, --description <text>', 'Criteria description (for llm-rubric type)')
    .option('--value <value>', 'Expected value (for contains/equals type)')
    .option('--pattern <pattern>', 'Regex pattern (for regex type)')
    .option('-w, --weight <n>', 'Weight for scoring (default: 1)')
    .option('--recursive', 'Add to all subtasks as well')
    .action(
      async (
        id: string,
        options: {
          description?: string;
          name: string;
          pattern?: string;
          recursive?: boolean;
          threshold?: string;
          type: string;
          value?: string;
          weight?: string;
        },
      ) => {
        const client = await getTrpcClient();

        // Build rubric config based on type
        const buildConfig = (): Record<string, any> | null => {
          switch (options.type) {
            case 'llm-rubric': {
              return { criteria: options.description || options.name };
            }
            case 'contains':
            case 'equals':
            case 'starts-with':
            case 'ends-with': {
              if (!options.value) {
                log.error(`--value is required for type "${options.type}"`);
                return null;
              }
              return { value: options.value };
            }
            case 'regex': {
              if (!options.pattern) {
                log.error('--pattern is required for type "regex"');
                return null;
              }
              return { pattern: options.pattern };
            }
            default: {
              return { criteria: options.description || options.name };
            }
          }
        };

        const config = buildConfig();
        if (!config) return;

        const rubric: Record<string, any> = {
          config,
          id: `rubric-${Date.now()}`,
          name: options.name,
          type: options.type,
          weight: options.weight ? Number.parseFloat(options.weight) : 1,
        };
        if (options.threshold) {
          rubric.threshold = Number.parseInt(options.threshold, 10) / 100;
        }

        const addToTask = async (taskId: string) => {
          const current = (await client.task.getReview.query({ id: taskId })).data as any;
          const rubrics = current?.rubrics || [];

          // Replace if same name exists, otherwise append
          const filtered = rubrics.filter((r: any) => r.name !== options.name);
          filtered.push(rubric);

          await client.task.updateReview.mutate({
            id: taskId,
            review: {
              autoRetry: current?.autoRetry ?? true,
              enabled: current?.enabled ?? true,
              judge: current?.judge ?? {},
              maxIterations: current?.maxIterations ?? 3,
              rubrics: filtered,
            },
          });
        };

        await addToTask(id);

        if (options.recursive) {
          const subtasks = await client.task.getSubtasks.query({ id });
          for (const s of subtasks.data || []) {
            await addToTask(s.id);
          }
          log.info(
            `Rubric "${options.name}" [${options.type}] added to ${pc.bold(id)} + ${(subtasks.data || []).length} subtask(s).`,
          );
        } else {
          log.info(`Rubric "${options.name}" [${options.type}] added.`);
        }
      },
    );

  rc.command('rm <id>')
    .description('Remove a review rubric')
    .requiredOption('-n, --name <name>', 'Rubric name to remove')
    .option('--recursive', 'Remove from all subtasks as well')
    .action(async (id: string, options: { name: string; recursive?: boolean }) => {
      const client = await getTrpcClient();

      const removeFromTask = async (taskId: string) => {
        const current = (await client.task.getReview.query({ id: taskId })).data as any;
        if (!current) return;

        const rubrics = (current.rubrics || []).filter((r: any) => r.name !== options.name);

        await client.task.updateReview.mutate({
          id: taskId,
          review: { ...current, rubrics },
        });
      };

      await removeFromTask(id);

      if (options.recursive) {
        const subtasks = await client.task.getSubtasks.query({ id });
        for (const s of subtasks.data || []) {
          await removeFromTask(s.id);
        }
        log.info(
          `Rubric "${options.name}" removed from ${pc.bold(id)} + ${(subtasks.data || []).length} subtask(s).`,
        );
      } else {
        log.info(`Rubric "${options.name}" removed.`);
      }
    });

  rv.command('run <id>')
    .description('Manually run review on content')
    .requiredOption('--content <text>', 'Content to review')
    .action(async (id: string, options: { content: string }) => {
      const client = await getTrpcClient();
      const result = (await client.task.runReview.mutate({
        content: options.content,
        id,
      })) as any;
      const r = result.data;

      console.log(
        `\n${r.passed ? pc.green('✓ Review passed') : pc.red('✗ Review failed')} (${r.overallScore}%)`,
      );
      for (const s of r.rubricResults || []) {
        const icon = s.passed ? pc.green('✓') : pc.red('✗');
        const pct = Math.round(s.score * 100);
        console.log(`  ${icon} ${s.rubricId}: ${pct}%${s.reason ? ` — ${s.reason}` : ''}`);
      }
      console.log();
    });
}
