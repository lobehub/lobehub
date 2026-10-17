import { Command } from 'commander';
import { expect, it, vi } from 'vitest';

import { registerProjectCommand } from './project';

// The move registration and handler were deleted. Commander alone rejects it.
// alint-expect
it('confirms the deleted move command cannot be parsed', async () => {
  const moveTask = vi.fn();
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
  registerProjectCommand(program, { moveTask });
  await expect(
    program.parseAsync(['node', 'test', 'project', 'task', 'move', 'project', 'task']),
  ).rejects.toMatchObject({ code: 'commander.unknownCommand', exitCode: 1 });
  expect(moveTask).not.toHaveBeenCalled();
});
