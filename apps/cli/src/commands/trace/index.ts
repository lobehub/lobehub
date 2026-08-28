import type { Command } from 'commander';

import { registerReplayCommand } from './replay';

export function registerTraceCommand(program: Command) {
  const trace = program.command('trace').description('Work with agent execution snapshots');

  registerReplayCommand(trace);
}
