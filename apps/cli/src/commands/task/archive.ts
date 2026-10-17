import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';

export function registerArchiveCommands(task: Command) {
  // ── archive / unarchive ─────────────────────────────────
  // Archiving is the user's "truly done" call: it hides the task from lists
  // without changing its status. Agents run it only when the user asks.

  const register = (name: 'archive' | 'unarchive', archived: boolean, description: string) =>
    task
      .command(`${name} <id>`)
      .description(description)
      .option('--json [fields]', 'Output JSON')
      .action(async (id: string, options: { json?: string | boolean }) => {
        const client = await getTrpcClient();
        const result = await client.task.archive.mutate({ archived, id });

        if (options.json !== undefined) {
          outputJson(result.data, options.json);
          return;
        }

        log.info(
          `Task ${pc.bold(result.data.identifier)} ${archived ? 'archived' : 'unarchived'}.`,
        );
      });

  register('archive', true, 'Archive a task (hidden from lists; status unchanged)');
  register('unarchive', false, 'Restore an archived task to lists');
}
