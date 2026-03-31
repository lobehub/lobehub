import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

export function registerCheckpointCommands(task: Command) {
  // ── checkpoint ──────────────────────────────────────────────

  const cp = task.command('checkpoint').description('Manage task checkpoints');

  cp.command('view <id>')
    .description('View checkpoint config for a task')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      const result = await client.task.getCheckpoint.query({ id });
      const c = result.data as any;

      console.log(`\n${pc.bold('Checkpoint config:')}`);
      console.log(`  onAgentRequest: ${c.onAgentRequest ?? pc.dim('not set (default: true)')}`);
      if (c.topic) {
        console.log(`  topic.before: ${c.topic.before ?? false}`);
        console.log(`  topic.after: ${c.topic.after ?? false}`);
      }
      if (c.tasks?.beforeIds?.length > 0) {
        console.log(`  tasks.beforeIds: ${c.tasks.beforeIds.join(', ')}`);
      }
      if (c.tasks?.afterIds?.length > 0) {
        console.log(`  tasks.afterIds: ${c.tasks.afterIds.join(', ')}`);
      }
      if (
        !c.topic &&
        !c.tasks?.beforeIds?.length &&
        !c.tasks?.afterIds?.length &&
        c.onAgentRequest === undefined
      ) {
        console.log(`  ${pc.dim('(no checkpoints configured)')}`);
      }
      console.log();
    });

  cp.command('set <id>')
    .description('Configure checkpoints')
    .option('--on-agent-request <bool>', 'Allow agent to request review (true/false)')
    .option('--topic-before <bool>', 'Pause before each topic (true/false)')
    .option('--topic-after <bool>', 'Pause after each topic (true/false)')
    .option('--before <ids>', 'Pause before these subtask identifiers (comma-separated)')
    .option('--after <ids>', 'Pause after these subtask identifiers (comma-separated)')
    .action(
      async (
        id: string,
        options: {
          after?: string;
          before?: string;
          onAgentRequest?: string;
          topicAfter?: string;
          topicBefore?: string;
        },
      ) => {
        const client = await getTrpcClient();

        // Get current config first
        const current = (await client.task.getCheckpoint.query({ id })).data as any;
        const checkpoint: any = { ...current };

        if (options.onAgentRequest !== undefined) {
          checkpoint.onAgentRequest = options.onAgentRequest === 'true';
        }
        if (options.topicBefore !== undefined || options.topicAfter !== undefined) {
          checkpoint.topic = { ...checkpoint.topic };
          if (options.topicBefore !== undefined)
            checkpoint.topic.before = options.topicBefore === 'true';
          if (options.topicAfter !== undefined)
            checkpoint.topic.after = options.topicAfter === 'true';
        }
        if (options.before !== undefined) {
          checkpoint.tasks = { ...checkpoint.tasks };
          checkpoint.tasks.beforeIds = options.before
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
        if (options.after !== undefined) {
          checkpoint.tasks = { ...checkpoint.tasks };
          checkpoint.tasks.afterIds = options.after
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        }

        await client.task.updateCheckpoint.mutate({ checkpoint, id });
        log.info('Checkpoint updated.');
      },
    );
}
