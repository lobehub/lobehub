import { expect, it } from 'vitest';

import { createProgram } from './commands';

it('rejects an unknown command', async () => {
  const program = createProgram();
  await expect(program.parseAsync(['node', 'test', 'missing'])).rejects.toMatchObject({
    code: 'commander.unknownCommand',
  });
});
