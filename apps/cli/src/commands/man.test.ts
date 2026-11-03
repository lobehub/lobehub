import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerManCommand } from './man';

describe('man command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();

    program.name('lh').description('Sample CLI').version('1.0.0');

    const generate = program
      .command('generate')
      .alias('gen')
      .description('Generate content')
      .option('-m, --model <model>', 'Model to use');

    generate
      .command('text <prompt>')
      .description('Generate text from a prompt')
      .option('--json', 'Output raw JSON');

    program.command('login').description('Log in to LobeHub');

    registerManCommand(program);
    program.exitOverride();

    return program;
  }

  it('renders a manual page for the root command', async () => {
    const program = createProgram();

    await program.parseAsync(['node', 'test', 'man']);

    const output = consoleSpy.mock.calls.at(0)?.[0];

    expect(output).toContain('LH(1)');
    expect(output).toContain('NAME\n  lh - Sample CLI');
    expect(output).toContain('ALIASES\n  lobe, lobehub');
    expect(output).toContain('SYNOPSIS\n  lh [options] [command]');
    expect(output).toContain('generate|gen [options] [command]');
    expect(output).toContain('man [options] [command...]');
  });

  it('renders a manual page for a command with subcommands', async () => {
    const program = createProgram();

    await program.parseAsync(['node', 'test', 'man', 'generate']);

    const output = consoleSpy.mock.calls.at(0)?.[0];

    expect(output).toContain('LH-GENERATE(1)');
    expect(output).toContain('NAME\n  lh generate - Generate content');
    expect(output).toContain('ALIASES\n  gen');
    expect(output).toContain('SYNOPSIS\n  lh generate [options] [command]');
    expect(output).toContain('text [options] <prompt>');
    expect(output).toContain('-m, --model <model>');
  });

  it('renders arguments for a leaf command', async () => {
    const program = createProgram();

    await program.parseAsync(['node', 'test', 'man', 'generate', 'text']);

    const output = consoleSpy.mock.calls.at(0)?.[0];

    expect(output).toContain('LH-GENERATE-TEXT(1)');
    expect(output).toContain('NAME\n  lh generate text - Generate text from a prompt');
    expect(output).toContain('ARGUMENTS');
    expect(output).toContain('<prompt>');
    expect(output).toContain('Required argument');
    expect(output).toContain('SEE ALSO');
  });
});
