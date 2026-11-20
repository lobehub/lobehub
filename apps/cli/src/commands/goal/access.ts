import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

/** Who runs a goal and who can see it: its agents and its workspace visibility. */
export function registerGoalAccessCommands(goal: Command) {
  goal
    .command('set-agent <id> <agent>')
    .description(
      'Hand the goal to a different supervising agent (its unfinished tasks follow unless the goal has a task agent)',
    )
    .option('--goal-only', 'Only change the goal-level agent; leave existing tasks as assigned')
    .action(async (id: string, agentId: string, options: { goalOnly?: boolean }) => {
      const result = await (
        await getTrpcClient()
      ).goal.setAgent.mutate({ agentId, goalOnly: options.goalOnly, id });
      log.info(result.message);
    });

  goal
    .command('set-task-agent <id> <agent>')
    .description(
      'Route the goal\'s tasks to a dedicated executor; "none" hands them back to the goal agent',
    )
    .option('--goal-only', 'Only change future tasks; leave existing tasks as assigned')
    .action(async (id: string, agent: string, options: { goalOnly?: boolean }) => {
      const result = await (
        await getTrpcClient()
      ).goal.setTaskAgent.mutate({
        agentId: agent === 'none' ? null : agent,
        goalOnly: options.goalOnly,
        id,
      });
      log.info(result.message);
    });

  goal
    .command('set-visibility <id> <visibility>')
    .description(
      'Make a workspace goal private (only you see it) or public (every member does); its tasks follow. A public goal needs public agents',
    )
    .action(async (id: string, visibility: string) => {
      if (visibility !== 'private' && visibility !== 'public')
        throw new Error('visibility must be one of: private, public');
      const result = await (await getTrpcClient()).goal.setVisibility.mutate({ id, visibility });
      const moved = result.data.taskIds.length;
      log.info(moved ? `${result.message}; ${moved} task(s) moved with it` : result.message);
    });
}
