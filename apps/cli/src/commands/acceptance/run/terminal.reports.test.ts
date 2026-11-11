import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/logger';
import { readLocalRound } from '../local/localRound';
import { attachAcceptanceRunCommands } from '.';
import { validateAcceptanceReport } from './reportSchema';

const node = process.execPath;

/**
 * Terminal bundles inside a report directory, read without a server: the
 * offline `run validate` check and the local (signed-out) report page must
 * treat a bundle exactly as ingest and the server gate do.
 */
describe('terminal bundles in offline reports', () => {
  let dir: string;
  const round = 'round-1';

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    dir = await mkdtemp(path.join(tmpdir(), 'lh-terminal-report-'));
    await mkdir(path.join(dir, round), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { force: true, recursive: true });
  });

  const run = async (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    attachAcceptanceRunCommands(program.command('acceptance'));
    await program.parseAsync(['node', 'lh', 'acceptance', 'run', ...args]);
  };

  /** A captured run and an authored example, both inside the round directory. */
  const bundles = async () => {
    await run(
      'evidence',
      'capture',
      '--out',
      path.join(dir, round, 'captured'),
      '--',
      node,
      '-e',
      'console.log("listed")',
    );
    await writeFile(path.join(dir, 'example.txt'), '$ lh agent list\nagent-1\n');
    await run(
      'evidence',
      'import',
      '--out',
      path.join(dir, round, 'authored'),
      '--input',
      path.join(dir, 'example.txt'),
      '--source',
      'authored',
    );
  };

  const report = (evidencePath: string) => ({
    cases: [
      {
        evidence: [{ description: 'agent list output', path: evidencePath }],
        id: 'list',
        observation: 'The command listed the agent.',
        status: 'pass',
        surface: 'cli',
      },
    ],
    plan: [
      {
        expected: 'The agent is listed.',
        id: 'list',
        method: 'Run lh agent list.',
        requiredEvidence: [{ provenance: 'execution', type: 'terminal' }],
        title: 'Agent list shows the agent',
      },
    ],
    summary: { verdict: 'pass' },
    title: 'Terminal evidence report',
  });

  const writeReport = (evidencePath: string) =>
    writeFile(path.join(dir, round, 'result.json'), JSON.stringify(report(evidencePath)));

  it('validates a captured bundle against an execution requirement', async () => {
    await bundles();
    await writeReport('captured');

    const result = await validateAcceptanceReport(path.join(dir, round));

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('refuses a pass backed only by an authored example', async () => {
    await bundles();
    await writeReport('authored/terminal.json');

    const result = await validateAcceptanceReport(path.join(dir, round));

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('"terminal" from a real command execution'),
      }),
    );
  });

  it('refuses a bundle edited after it was written', async () => {
    await bundles();
    await writeFile(path.join(dir, round, 'captured', 'stdout.txt'), 'all tests passed\n');
    await writeReport('captured');

    const result = await validateAcceptanceReport(path.join(dir, round));

    expect(result.errors).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('is invalid') }),
    );
  });

  it('renders a bundle as a terminal row with its transcript inline on the local page', async () => {
    await bundles();
    await writeReport('captured');

    const read = readLocalRound({
      acceptanceDir: dir,
      acceptanceId: 'local-acceptance',
      dir: round,
      roundIndex: 1,
    });

    expect(read.missingEvidence).toEqual([]);
    expect(read.source.evidence).toEqual([
      expect.objectContaining({
        content: await readFile(path.join(dir, round, 'captured', 'transcript.txt'), 'utf8'),
        fileUrl: null,
        metadata: { terminal: expect.objectContaining({ source: expect.anything() }) },
        type: 'terminal',
      }),
    ]);
    expect(read.source.results[0]).toMatchObject({ verdict: 'passed' });
  });

  it('keeps an authored example from passing an execution requirement on the local page', async () => {
    await bundles();
    await writeReport('authored');

    const read = readLocalRound({
      acceptanceDir: dir,
      acceptanceId: 'local-acceptance',
      dir: round,
      roundIndex: 1,
    });

    expect(read.missingEvidence).toEqual([{ checkItemId: 'list', types: ['terminal'] }]);
    expect(read.source.results[0]).toMatchObject({
      toulmin: expect.objectContaining({
        limitation: 'Required evidence not published: terminal from a real command execution.',
      }),
      verdict: 'uncertain',
    });
  });
});
