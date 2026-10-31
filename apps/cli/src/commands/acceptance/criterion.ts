import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../../utils/format';
import {
  assertEnum,
  ON_FAIL,
  type OnFail,
  parseConfig,
  VERIFIER_TYPES,
  type VerifierType,
} from './utils';

/** `criterion` — reusable pass/fail standards that rubrics and plans draw on. */
export function attachCriterionCommands(parent: Command): Command {
  const criterion = parent.command('criterion').description('Reusable pass/fail standards');

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

  return criterion;
}
