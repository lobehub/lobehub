import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../../utils/format';
import { log } from '../../utils/logger';

/** `rubric` — named groups of criteria a Task mounts as its acceptance contract. */
export function attachRubricCommands(parent: Command): Command {
  const rubric = parent.command('rubric').description('Named groups of criteria');

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

  return rubric;
}
