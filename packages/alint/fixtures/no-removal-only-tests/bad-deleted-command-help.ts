import { Command } from 'commander';
import { expect, it } from 'vitest';

import { registerProjectCommand } from './project';

// The project task move registration was deleted; no replacement handler exists.
// alint-expect
it('confirms the removed move command is absent from help', () => {
  const program = new Command();
  registerProjectCommand(program);
  const project = program.commands.find((command) => command.name() === 'project')!;
  const task = project.commands.find((command) => command.name() === 'task')!;
  expect(task.helpInformation()).not.toContain('move');
});
