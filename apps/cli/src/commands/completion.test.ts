import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCompletionCommand } from './completion';

describe('completion command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    delete process.env.LOBEHUB_COMP_CWORD;
    process.env.SHELL = originalShell;
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();

    program
      .command('agent')
      .description('Agent commands')
      .command('list')
      .description('List agents');
    program.command('generate').alias('gen').description('Generate content');
    program.command('usage').description('Usage').option('--month <YYYY-MM>', 'Month to query');
    program.command('internal', { hidden: true });

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
    process.env.LOBEHUB_COMP_CWORD = '0';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete', 'g']);

    expect(consoleSpy.mock.calls.map(([value]) => value)).toEqual(['gen', 'generate']);
  });

  it('should suggest nested subcommands in the current command context', async () => {
    process.env.LOBEHUB_COMP_CWORD = '1';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete', 'agent']);

    expect(consoleSpy).toHaveBeenCalledWith('list');
  });

  it('should suggest command options after leaf commands', async () => {
    process.env.LOBEHUB_COMP_CWORD = '1';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete', 'usage']);

    expect(consoleSpy).toHaveBeenCalledWith('--month');
  });

  it('should not suggest commands while completing an option value', async () => {
    process.env.LOBEHUB_COMP_CWORD = '2';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete', 'usage', '--month']);

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should not expose hidden commands', async () => {
    process.env.LOBEHUB_COMP_CWORD = '0';

    const program = createProgram();
    await program.parseAsync(['node', 'test', '__complete']);

    expect(consoleSpy.mock.calls.map(([value]) => value)).not.toContain('internal');
    expect(consoleSpy.mock.calls.map(([value]) => value)).not.toContain('__complete');
  });
});
