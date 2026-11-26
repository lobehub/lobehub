import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';
import { resolveAppUrlBuilder } from '../task/url';

/**
 * `lh goal archive` / `unarchive`. Archiving is the user's call, like a task's:
 * it hides a completed or canceled goal from every list without changing its
 * status. Agents run it only when the user asks.
 */
export function registerGoalArchiveCommands(goal: Command) {
  const register = (name: 'archive' | 'unarchive', archived: boolean, description: string) =>
    goal
      .command(`${name} <id>`)
      .description(description)
      .option('--json [fields]', 'Output JSON')
      .action(async (id: string, options: { json?: boolean | string }) => {
        const client = await getTrpcClient();
        const result = await client.goal.archive.mutate({ archived, id });
        if (options.json !== undefined) {
          // Best-effort link, like every other goal command's.
          const url = await resolveAppUrlBuilder(client)
            .then((build) => build(`/goal/${encodeURIComponent(result.data.id)}`))
            .catch(() => undefined);
          return outputJson({ ...result.data, url }, options.json);
        }
        log.info(result.message);
      });

  register(
    'archive',
    true,
    'Archive a completed or canceled goal (hidden from lists; status unchanged)',
  );
  register('unarchive', false, 'Restore an archived goal to lists');
}
