// Fixture: a subtree attached to the canonical command but not to its deprecated alias,
// with the omitted side in its own test.
import { Command } from 'commander';
import { expect, it, vi } from 'vitest';

import { registerAcceptanceCommands } from './index';

const deleteRun = vi.fn();

it('routes `acceptance run delete` to the deleteRun mutation', async () => {
  const program = new Command().exitOverride();
  registerAcceptanceCommands(program, { deleteRun });
  await program.parseAsync(['node', 'lh', 'acceptance', 'run', 'delete', 'run_1', '--yes']);
  expect(deleteRun).toHaveBeenCalledWith({ runId: 'run_1' });
});

it('does NOT attach the run subtree to the deprecated `verify acceptance` alias', () => {
  const program = new Command().exitOverride();
  registerAcceptanceCommands(program, { deleteRun, deprecated: true });
  const acceptance = program.commands.find((c) => c.name() === 'acceptance');
  expect(acceptance?.commands.some((c) => c.name() === 'run')).toBe(false);
});
