import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProgram } from './program';

const { mockApply } = vi.hoisted(() => ({ mockApply: vi.fn() }));

vi.mock('./api/workspaceRef', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  applyWorkspaceOverride: mockApply,
}));

/** Commander parses the tree for real; only the action's effect is stubbed. */
const run = async (...args: string[]) => {
  const program = createProgram();
  const search = program.commands.find((c) => c.name() === 'search')!;
  const seen: Record<string, unknown> = {};
  search.action((options) => {
    Object.assign(seen, options);
  });
  await program.parseAsync(['node', 'lh', ...args]);
  return seen;
};

describe('global --workspace flag', () => {
  beforeEach(() => {
    mockApply.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies before the subcommand and names the top-level command', async () => {
    await run('-w', 'acme', 'search', '-q', 'hello');
    expect(mockApply).toHaveBeenCalledWith('acme', 'search', false);
  });

  it('runs the override with no flag so the env value is still resolved', async () => {
    await run('search', '-q', 'hello');
    expect(mockApply).toHaveBeenCalledWith(undefined, 'search', false);
  });

  // Regression: a root `-w` would otherwise swallow `search -w` (web).
  it("leaves a subcommand's own -w to that subcommand", async () => {
    const options = await run('search', '-q', 'hello', '-w');
    expect(options.web).toBe(true);
    expect(mockApply).toHaveBeenCalledWith(undefined, 'search', false);
  });

  it('tells the override when the command has its own --workspace', async () => {
    const program = createProgram();
    const members = program.commands
      .find((c) => c.name() === 'workspace')!
      .commands.find((c) => c.name() === 'members')!;
    members.action(() => {});

    await program.parseAsync(['node', 'lh', 'workspace', 'members', '-w', 'acme']);

    expect(mockApply).toHaveBeenCalledWith(undefined, 'workspace', true);
  });

  it('shows the flag in the root help', () => {
    expect(createProgram().helpInformation()).toContain('-w, --workspace <id|slug>');
  });
});
