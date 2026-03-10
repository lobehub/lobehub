import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';

// ── Memory Categories ───────────────────────────────────────

const CATEGORIES = ['identity', 'activity', 'context', 'experience', 'preference'] as const;
type Category = (typeof CATEGORIES)[number];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function registerMemoryCommand(program: Command) {
  const memory = program.command('memory').description('Manage user memories');

  // ── list ──────────────────────────────────────────────

  memory
    .command('list')
    .description('List memories by category')
    .argument('[category]', `Memory category: ${CATEGORIES.join(', ')} (default: all)`)
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (category: string | undefined, options: { json?: string | boolean }) => {
      if (category && !CATEGORIES.includes(category as Category)) {
        log.error(`Invalid category: ${category}. Must be one of: ${CATEGORIES.join(', ')}`);
        process.exit(1);
      }

      const client = await getTrpcClient();
      const categoriesToFetch = category ? [category as Category] : [...CATEGORIES];
      const allResults: Record<string, any[]> = {};

      for (const cat of categoriesToFetch) {
        try {
          allResults[cat] = await fetchCategory(client, cat);
        } catch {
          allResults[cat] = [];
        }
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(category ? allResults[category] : allResults, fields);
        return;
      }

      for (const [cat, items] of Object.entries(allResults)) {
        if (!Array.isArray(items) || items.length === 0) {
          if (category) console.log(`No ${cat} memories found.`);
          continue;
        }

        console.log();
        console.log(pc.bold(pc.cyan(`── ${capitalize(cat)} (${items.length}) ──`)));

        const rows = items.map((item: any) => {
          const desc =
            item.description ||
            item.narrative ||
            item.title ||
            item.situation ||
            item.conclusionDirectives ||
            item.content ||
            '';
          return [
            item.id || '',
            truncate(item.type || item.role || item.status || '', 20),
            truncate(desc, 60),
          ];
        });

        printTable(rows, ['ID', 'TYPE/STATUS', 'DESCRIPTION']);
      }
    });

  // ── create ────────────────────────────────────────────

  memory
    .command('create')
    .description('Create an identity memory entry (other categories are created via extraction)')
    .option('--type <type>', 'Memory type')
    .option('--role <role>', 'Role')
    .option('--relationship <rel>', 'Relationship')
    .option('-d, --description <desc>', 'Description')
    .option('--labels <labels...>', 'Extracted labels')
    .action(async (options: Record<string, any>) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = {};
      if (options.type) input.type = options.type;
      if (options.role) input.role = options.role;
      if (options.relationship) input.relationship = options.relationship;
      if (options.description) input.description = options.description;
      if (options.labels) input.extractedLabels = options.labels;

      try {
        const result = await (client.userMemory as any).createIdentity.mutate(input);
        const memoryId = result?.userMemoryId || 'unknown';
        const identityId = result?.identityId || 'unknown';
        console.log(
          `${pc.green('✓')} Created identity memory ${pc.bold(memoryId)} (identity: ${pc.bold(identityId)})`,
        );
      } catch (error: any) {
        log.error(`Failed to create identity: ${error.message}`);
        process.exit(1);
        return;
      }
    });

  // ── edit ──────────────────────────────────────────────

  memory
    .command('edit <category> <id>')
    .description(`Update a memory entry (${CATEGORIES.join(', ')})`)
    .option('--type <type>', 'Memory type (for identity)')
    .option('--role <role>', 'Role (for identity)')
    .option('--relationship <rel>', 'Relationship (for identity)')
    .option('-d, --description <desc>', 'Description')
    .option('--narrative <text>', 'Narrative (for activity)')
    .option('--notes <text>', 'Notes (for activity)')
    .option('--status <status>', 'Status (for activity/context)')
    .option('--title <title>', 'Title (for context)')
    .option('--situation <text>', 'Situation (for experience)')
    .option('--action <text>', 'Action (for experience)')
    .option('--key-learning <text>', 'Key learning (for experience)')
    .option('--directives <text>', 'Conclusion directives (for preference)')
    .option('--suggestions <text>', 'Suggestions (for preference)')
    .option('--labels <labels...>', 'Extracted labels')
    .action(async (category: string, id: string, options: Record<string, any>) => {
      if (!CATEGORIES.includes(category as Category)) {
        log.error(`Invalid category: ${category}. Must be one of: ${CATEGORIES.join(', ')}`);
        process.exit(1);
      }

      const client = await getTrpcClient();
      const router = client.userMemory as any;
      const mutationName = `update${capitalize(category)}`;

      const data = buildCategoryInput(category as Category, options);

      try {
        await router[mutationName].mutate({ data, id });
        console.log(`${pc.green('✓')} Updated ${category} memory ${pc.bold(id)}`);
      } catch (error: any) {
        log.error(`Failed to update ${category}: ${error.message}`);
        process.exit(1);
        return;
      }
    });

  // ── delete ────────────────────────────────────────────

  memory
    .command('delete <category> <id>')
    .description(`Delete a memory entry (${CATEGORIES.join(', ')})`)
    .option('--yes', 'Skip confirmation prompt')
    .action(async (category: string, id: string, options: { yes?: boolean }) => {
      if (!CATEGORIES.includes(category as Category)) {
        log.error(`Invalid category: ${category}. Must be one of: ${CATEGORIES.join(', ')}`);
        process.exit(1);
      }

      if (!options.yes) {
        const confirmed = await confirm(`Delete this ${category} memory?`);
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      const router = client.userMemory as any;
      const mutationName = `delete${capitalize(category)}`;

      try {
        await router[mutationName].mutate({ id });
        console.log(`${pc.green('✓')} Deleted ${category} memory ${pc.bold(id)}`);
      } catch (error: any) {
        log.error(`Failed to delete ${category}: ${error.message}`);
        process.exit(1);
        return;
      }
    });

  // ── persona ───────────────────────────────────────────

  memory
    .command('persona')
    .description('View your memory persona summary')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const persona = await client.userMemory.getPersona.query();

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(persona, fields);
        return;
      }

      if (!persona) {
        console.log('No persona data available.');
        return;
      }

      console.log(pc.bold('User Persona'));
      console.log();
      console.log(typeof persona === 'string' ? persona : JSON.stringify(persona, null, 2));
    });

  // ── extract ───────────────────────────────────────────

  memory
    .command('extract')
    .description('Extract memories from chat history')
    .option('--from <date>', 'Start date (ISO format)')
    .option('--to <date>', 'End date (ISO format)')
    .action(async (options: { from?: string; to?: string }) => {
      const client = await getTrpcClient();

      const input: { fromDate?: Date; toDate?: Date } = {};
      if (options.from) input.fromDate = new Date(options.from);
      if (options.to) input.toDate = new Date(options.to);

      const result = await client.userMemory.requestMemoryFromChatTopic.mutate(input);
      console.log(`${pc.green('✓')} Memory extraction started`);
      if ((result as any)?.id) {
        console.log(`Task ID: ${pc.bold((result as any).id)}`);
      }
      console.log(pc.dim('Use "lh memory extract-status" to check progress.'));
    });

  // ── extract-status ────────────────────────────────────

  memory
    .command('extract-status')
    .description('Check memory extraction task status')
    .option('--task-id <id>', 'Specific task ID to check')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; taskId?: string }) => {
      const client = await getTrpcClient();

      const input: { taskId?: string } = {};
      if (options.taskId) input.taskId = options.taskId;

      const result = await client.userMemory.getMemoryExtractionTask.query(input);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      if (!result) {
        console.log('No extraction task found.');
        return;
      }

      const r = result as any;
      console.log(pc.bold('Memory Extraction Task'));
      if (r.id) console.log(`  ID:     ${r.id}`);
      if (r.status) console.log(`  Status: ${r.status}`);
      if (r.metadata) console.log(`  Detail: ${JSON.stringify(r.metadata)}`);
    });
}

// ── Helpers ─────────────────────────────────────────────────

async function fetchCategory(client: any, category: Category): Promise<any[]> {
  const router = client.userMemory;
  switch (category) {
    case 'identity': {
      return router.getIdentities.query();
    }
    case 'activity': {
      return router.getActivities.query();
    }
    case 'context': {
      return router.getContexts.query();
    }
    case 'experience': {
      return router.getExperiences.query();
    }
    case 'preference': {
      return router.getPreferences.query();
    }
    default: {
      return [];
    }
  }
}

function buildCategoryInput(category: Category, options: Record<string, any>): Record<string, any> {
  const input: Record<string, any> = {};

  switch (category) {
    case 'identity': {
      if (options.type) input.type = options.type;
      if (options.role) input.role = options.role;
      if (options.relationship) input.relationship = options.relationship;
      if (options.description) input.description = options.description;
      if (options.labels) input.extractedLabels = options.labels;
      break;
    }
    case 'activity': {
      if (options.narrative) input.narrative = options.narrative;
      if (options.notes) input.notes = options.notes;
      if (options.status) input.status = options.status;
      break;
    }
    case 'context': {
      if (options.title) input.title = options.title;
      if (options.description) input.description = options.description;
      if (options.status) input.currentStatus = options.status;
      break;
    }
    case 'experience': {
      if (options.situation) input.situation = options.situation;
      if (options.action) input.action = options.action;
      if (options.keyLearning) input.keyLearning = options.keyLearning;
      break;
    }
    case 'preference': {
      if (options.directives) input.conclusionDirectives = options.directives;
      if (options.suggestions) input.suggestions = options.suggestions;
      break;
    }
  }

  return input;
}
