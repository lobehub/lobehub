// Fixture: a deprecated command hidden from help while it keeps running.
import { Command } from 'commander';
import { expect, it, vi } from 'vitest';

import { registerAcceptanceCommands, registerVerifyCommand } from './commands';
import { log } from './logger';

const createProgram = () => {
  const program = new Command().exitOverride();
  registerVerifyCommand(program);
  registerAcceptanceCommands(program);
  return program;
};

it('keeps `lh verify rubric list` working and names its replacement', async () => {
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
  await createProgram().parseAsync(['node', 'lh', 'verify', 'rubric', 'list']);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('use `lh acceptance rubric list`'));
});

it('keeps `lh verify` out of help and the man page', () => {
  const program = createProgram();
  const visible = program
    .createHelp()
    .visibleCommands(program)
    .map((c) => c.name());

  expect(visible).toContain('acceptance');
  expect(visible).not.toContain('verify');
});
