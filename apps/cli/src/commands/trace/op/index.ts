import type { Command } from 'commander';

import { registerOpInspectCommand } from './inspect';
import { registerOpListCommand } from './list';
import { registerOpReplayCommand } from './replay';

/**
 * `lh trace op` — traces of a single agent operation. Sibling scopes (goal,
 * task) get their own group under `lh trace` rather than more flags here.
 */
export function registerOpCommand(parent: Command) {
  const op = parent.command('op').description('Traces of a single agent operation');

  registerOpInspectCommand(op);
  registerOpListCommand(op);
  registerOpReplayCommand(op);
}
