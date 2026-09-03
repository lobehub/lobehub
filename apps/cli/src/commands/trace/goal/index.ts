import type { Command } from 'commander';

import { registerGoalInspectCommand } from './inspect';
import { registerGoalListCommand } from './list';

/**
 * `lh trace goal` — traces of a whole goal run, one scale above `lh trace op`.
 * A goal's advances dispatch operations, so an advance's `op=` hands off to
 * `lh trace op inspect`.
 */
export function registerGoalCommand(parent: Command) {
  const goal = parent.command('goal').description('Traces of a whole goal run');

  registerGoalInspectCommand(goal);
  registerGoalListCommand(goal);
}
