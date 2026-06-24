import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerVerifyCommand } from './verify';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    verify: {
      createRubric: { mutate: vi.fn() },
      getRubric: { query: vi.fn() },
      getSkillBundle: { query: vi.fn() },
      updateRubric: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('verify rubric config commands', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.verify.createRubric.mutate.mockReset().mockResolvedValue({ id: 'rub-1' });
    mockTrpcClient.verify.updateRubric.mutate.mockReset().mockResolvedValue(undefined);
    mockTrpcClient.verify.getRubric.query.mockReset();
  });

  afterEach(() => consoleSpy.mockRestore());

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('passes maxRepairRounds config when creating a rubric', async () => {
    await run(['rubric', 'create', '-t', 'Standard', '--max-repair-rounds', '3']);

    expect(mockTrpcClient.verify.createRubric.mutate).toHaveBeenCalledWith({
      config: { maxRepairRounds: 3 },
      description: undefined,
      title: 'Standard',
    });
  });

  it('omits config when no max-repair-rounds flag is given', async () => {
    await run(['rubric', 'create', '-t', 'Standard']);

    expect(mockTrpcClient.verify.createRubric.mutate).toHaveBeenCalledWith({
      config: undefined,
      description: undefined,
      title: 'Standard',
    });
  });

  it('updates only the config when max-repair-rounds is passed', async () => {
    await run(['rubric', 'update', 'rub-1', '--max-repair-rounds', '0']);

    expect(mockTrpcClient.verify.updateRubric.mutate).toHaveBeenCalledWith({
      id: 'rub-1',
      value: { config: { maxRepairRounds: 0 } },
    });
  });

  it('views a rubric and prints its repair-round config', async () => {
    mockTrpcClient.verify.getRubric.query.mockResolvedValue({
      config: { maxRepairRounds: 4 },
      description: 'desc',
      id: 'rub-1',
      title: 'Standard',
    });

    await run(['rubric', 'view', 'rub-1']);

    expect(mockTrpcClient.verify.getRubric.query).toHaveBeenCalledWith({ id: 'rub-1' });
    const printed = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Standard');
    expect(printed).toContain('4');
  });
});

describe('verify evidence upload command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetTrpcClient.mockReset();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code}`);
    }) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('rejects evidence with both file and inline content', async () => {
    await expect(
      run([
        'evidence',
        'upload',
        '--check',
        'result-1',
        '--type',
        'text',
        '--file',
        'artifact.txt',
        '--content',
        'inline payload',
      ]),
    ).rejects.toThrow('process.exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGetTrpcClient).not.toHaveBeenCalled();
  });
});

describe('verify init command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let dir: string;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.verify.getSkillBundle.query.mockReset().mockResolvedValue({
      content: '# Verify SKILL',
      files: { 'references/plan-format.md': 'plan', 'surfaces/cli.md': 'cli' },
      identifier: 'verify',
      name: 'Verify',
    });
    dir = mkdtempSync(path.join(tmpdir(), 'verify-init-'));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(dir, { force: true, recursive: true });
  });

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('writes SKILL.md and resource files into .claude/skills/verify', async () => {
    await run(['init', '--dir', dir]);

    expect(mockTrpcClient.verify.getSkillBundle.query).toHaveBeenCalledWith({
      identifier: 'verify',
    });
    const skillDir = path.join(dir, '.claude', 'skills', 'verify');
    expect(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toBe('# Verify SKILL');
    expect(readFileSync(path.join(skillDir, 'references/plan-format.md'), 'utf8')).toBe('plan');
    expect(readFileSync(path.join(skillDir, 'surfaces/cli.md'), 'utf8')).toBe('cli');
  });

  it('skips existing files without --force and overwrites with it', async () => {
    const skillFile = path.join(dir, '.claude', 'skills', 'verify', 'SKILL.md');
    await run(['init', '--dir', dir]);

    // server now serves updated content
    mockTrpcClient.verify.getSkillBundle.query.mockResolvedValue({
      content: '# Updated SKILL',
      files: {},
      identifier: 'verify',
      name: 'Verify',
    });

    await run(['init', '--dir', dir]); // no --force → keep existing
    expect(readFileSync(skillFile, 'utf8')).toBe('# Verify SKILL');

    await run(['init', '--dir', dir, '--force']); // --force → overwrite
    expect(readFileSync(skillFile, 'utf8')).toBe('# Updated SKILL');
  });

  it('reports the written/skipped counts as JSON', async () => {
    await run(['init', '--dir', dir, '--json']);
    const out = JSON.parse(consoleSpy.mock.calls.map((c) => String(c[0])).join(''));
    expect(out.skill).toBe('verify');
    expect(out.written).toContain('SKILL.md');
    expect(existsSync(path.join(out.dir, 'SKILL.md'))).toBe(true);
  });
});
