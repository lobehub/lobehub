import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLI_COMPLETION_CWORD_ENV } from '../constants/identity';
import { registerCompletionCommand } from './completion';

const { mockListWorkspaces, mockPickAuthSource, mockGetValidToken } = vi.hoisted(() => ({
  mockGetValidToken: vi.fn(),
  mockListWorkspaces: vi.fn(),
  mockPickAuthSource: vi.fn(),
}));

vi.mock('../api/workspaceRef', () => ({ listWorkspaces: mockListWorkspaces }));
vi.mock('../auth/refresh', () => ({ getValidToken: mockGetValidToken }));
vi.mock('../auth/source', () => ({ pickAuthSource: mockPickAuthSource }));

describe('completion command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    delete process.env[CLI_COMPLETION_CWORD_ENV];
    process.env.SHELL = originalShell;
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    program.enablePositionalOptions();

    program
      .command('agent')
      .description('Agent commands')
      .command('list')
      .description('List agents');
    program.command('generate').alias('gen').description('Generate content');
    program.command('usage').description('Usage').option('--month <YYYY-MM>', 'Month to query');
    program.command('internal', { hidden: true });
    program.option('-w, --workspace <id|slug>', 'Workspace');
    program.command('search').option('-w, --web', 'Web');
    program.command('connect').option('--workspace <id>', 'Workspace id');

    registerCompletionCommand(program);

    return program;
  }

  it('should output zsh completion script by default', async () => {
    process.env.SHELL = '/bin/zsh';

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'completion']);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('compdef _lobehub_completion'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('lh lobe lobehub'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"${(@)words[@]:1}"'));
  });

  it('should output bash completion script when requested', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'completion', 'bash']);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('complete -o nosort'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('__complete'));
  });

  it('should suggest root commands and aliases', async () => {
    process.env[CLI_COMPLETION_CWORD_ENV] = '0';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete', 'g']);

    expect(consoleSpy.mock.calls.map(([value]) => value)).toEqual(['gen', 'generate']);
  });

  it('should suggest nested subcommands in the current command context', async () => {
    process.env[CLI_COMPLETION_CWORD_ENV] = '1';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete', 'agent']);

    expect(consoleSpy).toHaveBeenCalledWith('list');
  });

  it('should suggest command options after leaf commands', async () => {
    process.env[CLI_COMPLETION_CWORD_ENV] = '1';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete', 'usage']);

    expect(consoleSpy).toHaveBeenCalledWith('--month');
  });

  it('should not suggest commands while completing an option value', async () => {
    process.env[CLI_COMPLETION_CWORD_ENV] = '2';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete', 'usage', '--month']);

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should not expose hidden commands', async () => {
    process.env[CLI_COMPLETION_CWORD_ENV] = '0';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete']);

    expect(consoleSpy.mock.calls.map(([value]) => value)).not.toContain('internal');
    expect(consoleSpy.mock.calls.map(([value]) => value)).not.toContain('__complete');
  });

  describe('--workspace values', () => {
    beforeEach(() => {
      mockPickAuthSource.mockReturnValue({ kind: 'stored' });
      mockGetValidToken.mockResolvedValue({ status: 'ok' });
      mockListWorkspaces.mockResolvedValue([{ slug: 'acme' }, { slug: 'beta' }]);
    });

    it('suggests workspace slugs after the global flag', async () => {
      process.env[CLI_COMPLETION_CWORD_ENV] = '1';
      await createProgram().parseAsync(['node', 'test', '__complete', '-w', 'a']);
      expect(consoleSpy.mock.calls.map(([value]) => value)).toEqual(['acme']);
    });

    it('stays silent when not logged in', async () => {
      mockGetValidToken.mockResolvedValue({ status: 'missing' });
      process.env[CLI_COMPLETION_CWORD_ENV] = '1';
      await createProgram().parseAsync(['node', 'test', '__complete', '--workspace', '']);
      expect(mockListWorkspaces).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('stays silent when the lookup fails', async () => {
      mockListWorkspaces.mockRejectedValue(new Error('offline'));
      process.env[CLI_COMPLETION_CWORD_ENV] = '1';
      await createProgram().parseAsync(['node', 'test', '__complete', '-w', '']);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('does not suggest slugs for a --workspace that takes an id only', async () => {
      process.env[CLI_COMPLETION_CWORD_ENV] = '2';
      await createProgram().parseAsync([
        'node',
        'test',
        '__complete',
        'connect',
        '--workspace',
        '',
      ]);
      expect(mockListWorkspaces).not.toHaveBeenCalled();
    });

    it("does not treat another command's boolean -w as a workspace value", async () => {
      process.env[CLI_COMPLETION_CWORD_ENV] = '2';
      await createProgram().parseAsync(['node', 'test', '__complete', 'search', '-w', '']);
      expect(mockListWorkspaces).not.toHaveBeenCalled();
    });
  });
});
