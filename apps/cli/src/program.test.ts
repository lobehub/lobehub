import { describe, expect, it, vi } from 'vitest';

import { cliVersion } from './pkg';
import { createProgram } from './program';

vi.mock('./api/client', () => ({
  getTrpcClient: vi.fn(async () => {
    throw new Error('reached the subcommand action');
  }),
}));

const parse = (...args: string[]) => {
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  return program.parseAsync(['node', 'lh', ...args]);
};

describe('createProgram --version', () => {
  it('prints the CLI version before a subcommand', async () => {
    await expect(parse('--version')).rejects.toMatchObject({
      code: 'commander.version',
      message: cliVersion,
    });
  });

  it("leaves a subcommand's own --version option to the subcommand", async () => {
    await expect(parse('widget', 'publish', 'w-1', '--version', 'v-1', '--yes')).rejects.toThrow(
      'reached the subcommand action',
    );
  });
});
