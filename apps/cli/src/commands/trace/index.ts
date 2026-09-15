import type { Command } from 'commander';

import { registerGoalCommand } from './goal';
import { registerOpCommand } from './op';

export function registerTraceCommand(program: Command) {
  const trace = program
    .command('trace')
    .description('Inspect and replay recorded agent execution traces');

  registerOpCommand(trace);
  registerGoalCommand(trace);
}
