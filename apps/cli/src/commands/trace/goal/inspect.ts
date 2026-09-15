import { renderGoalAdvanceDetail, renderGoalTrajectory } from '@lobechat/agent-tracing';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';

import { resolveTrajectoryOrExit } from './trajectory';

export function registerGoalInspectCommand(parent: Command) {
  parent
    .command('inspect')
    .alias('i')
    .description("Inspect a goal's trajectory: its advances, and the decision behind each tick")
    .argument('<target>', 'Goal id, trajectory json path, or URL')
    .option(
      '-a, --advance <n>',
      'Show one advance in full, with the frontier it ranked',
      (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed))
          throw new InvalidArgumentError('--advance must be an integer');
        return parsed;
      },
    )
    .option('-j, --json', 'Output as JSON')
    .action(async (target: string, opts: { advance?: number; json?: boolean }) => {
      const trajectory = await resolveTrajectoryOrExit(target);

      if (opts.json) {
        console.log(JSON.stringify(trajectory, null, 2));
        return;
      }

      console.log(
        opts.advance === undefined
          ? renderGoalTrajectory(trajectory)
          : renderGoalAdvanceDetail(trajectory, opts.advance),
      );
    });
}
