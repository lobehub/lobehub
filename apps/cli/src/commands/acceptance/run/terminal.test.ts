import { existsSync } from 'node:fs';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseAsciicast } from '@lobechat/utils/verify/asciicast';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../../../api/client';
import { resolveServerUrl } from '../../../settings';
import { log } from '../../../utils/logger';
import { uploadLocalFile } from '../../../utils/uploadLocalFile';
import { attachAcceptanceRunCommands } from '.';
import { publishTerminalBundle } from './terminal';

vi.mock('../../../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../../../api/workspace', () => ({ resolveWorkspaceId: vi.fn() }));
vi.mock('../../../settings', () => ({ resolveServerUrl: vi.fn() }));
vi.mock('../../../utils/uploadLocalFile', () => ({ uploadLocalFile: vi.fn() }));

const node = process.execPath;

describe('terminal evidence', () => {
  const client = {
    acceptance: {
      attachRun: { mutate: vi.fn() },
      ensure: { mutate: vi.fn() },
      getBundle: { query: vi.fn() },
      setProject: { mutate: vi.fn() },
    },
    acceptanceComment: { create: { mutate: vi.fn() } },
    project: { find: { query: vi.fn() } },
    verify: {
      createRun: { mutate: vi.fn() },
      getRun: { query: vi.fn() },
      ingestResult: { mutate: vi.fn() },
      submitCheckEvidence: { mutate: vi.fn() },
      uploadEvidence: { mutate: vi.fn() },
      upsertReport: { mutate: vi.fn() },
    },
    // Submit and ingest check report text against the reader's language first.
    user: { getUserState: { query: vi.fn() } },
  };
  let dir: string;
  let printed: string[];
  let errors: string[];
  let uploads: string[];

  beforeEach(async () => {
    vi.resetAllMocks();
    printed = [];
    errors = [];
    uploads = [];
    vi.spyOn(console, 'log').mockImplementation((line) => printed.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line) => errors.push(String(line)));
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.spyOn(log, 'error').mockImplementation((line) => errors.push(String(line)));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.mocked(resolveServerUrl).mockReturnValue('https://app.lobehub.com');
    vi.mocked(getTrpcClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof getTrpcClient>>,
    );
    vi.mocked(uploadLocalFile).mockImplementation(async (_client, file) => {
      uploads.push(path.basename(file));
      return { id: `file-${path.basename(file)}`, url: '' } as any;
    });
    client.user.getUserState.query.mockResolvedValue({
      settings: { general: { responseLanguage: 'en-US' } },
    });
    client.acceptance.ensure.mutate.mockResolvedValue({ id: 'acceptance-1' });
    client.acceptance.getBundle.query.mockResolvedValue({});
    client.acceptance.attachRun.mutate.mockResolvedValue({ id: 'run-1', roundIndex: 1 });
    client.verify.createRun.mutate.mockResolvedValue({ id: 'run-1' });
    client.verify.ingestResult.mutate.mockImplementation(async (input) => ({
      id: `result-${input.checkItemId}`,
    }));
    client.verify.uploadEvidence.mutate.mockResolvedValue({ id: 'evidence-1' });
    client.verify.submitCheckEvidence.mutate.mockResolvedValue({
      checkResult: { id: 'result-1', verifyRunId: 'run-1' },
      evidence: [{ id: 'evidence-1' }],
    });
    client.verify.getRun.query.mockResolvedValue({ acceptanceId: 'acceptance-1', roundIndex: 1 });
    dir = await mkdtemp(path.join(tmpdir(), 'lh-terminal-'));
    // This repository declares a project in `.agents/acceptance/config.json`;
    // run outside it so ingest only sees what the test declares.
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
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
  const record = async (bundle: string) =>
    JSON.parse(await readFile(path.join(bundle, 'terminal.json'), 'utf8'));

  describe('capture', () => {
    it('keeps stdout, stderr and a failing exit status apart', async () => {
      const out = path.join(dir, 'pipe');
      await run(
        'evidence',
        'capture',
        '--out',
        out,
        '--',
        node,
        '-e',
        'process.stdout.write("out\\n"); process.stderr.write("err\\n"); process.exit(3)',
      );

      const terminal = await record(out);
      expect(terminal).toMatchObject({
        capture: { mode: 'pipe', streamLayout: 'separate', timing: 'unavailable' },
        execution: { exitCode: 3, outcome: 'exited', signal: null },
        source: { kind: 'captured' },
      });
      expect(await readFile(path.join(out, 'stdout.txt'), 'utf8')).toBe('out\n');
      expect(await readFile(path.join(out, 'stderr.txt'), 'utf8')).toBe('err\n');
      expect(terminal.artifacts.cast).toBeNull();
      const transcript = await readFile(path.join(out, 'transcript.txt'), 'utf8');
      expect(transcript).toContain('# result: exit 3');
      expect(transcript).toContain('--- stderr ---\nerr');
    });

    it('records a timeout as a timeout, not a signal or an exit', async () => {
      const out = path.join(dir, 'slow');
      await run(
        'evidence',
        'capture',
        '--timeout',
        '1',
        '--out',
        out,
        '--',
        node,
        '-e',
        'setTimeout(() => {}, 10000)',
      );
      expect((await record(out)).execution).toMatchObject({
        exitCode: null,
        outcome: 'timed_out',
        signal: 'SIGTERM',
      });
    });

    it.skipIf(process.platform === 'win32')(
      'stops everything a --shell command started when it times out',
      async () => {
        const out = path.join(dir, 'tree');
        const started = Date.now();
        // The shell's children hold the output pipes; killing only the shell
        // used to leave them running, so capture waited for them to finish.
        await run(
          'evidence',
          'capture',
          '--shell',
          '--timeout',
          '1',
          '--out',
          out,
          '--',
          'sleep 30 & sleep 30; echo done',
        );
        expect(Date.now() - started).toBeLessThan(10_000);
        expect((await record(out)).execution).toMatchObject({ outcome: 'timed_out' });
      },
      20_000,
    );

    it('keeps a multibyte character whole across the head/tail boundary', async () => {
      const out = path.join(dir, 'utf8');
      // 4 ASCII bytes then a 3-byte '€' straddle the middle of a 10-byte budget.
      await run(
        'evidence',
        'capture',
        '--max-bytes',
        '10',
        '--out',
        out,
        '--',
        node,
        '-e',
        'process.stdout.write("abcd€")',
      );
      expect(await readFile(path.join(out, 'stdout.txt'), 'utf8')).toBe('abcd€');
      expect((await record(out)).processing.truncation).toEqual([]);
    });

    it('cuts truncated output at character boundaries and counts the cut bytes', async () => {
      const out = path.join(dir, 'utf8-truncated');
      await run(
        'evidence',
        'capture',
        '--max-bytes',
        '10',
        '--out',
        out,
        '--',
        node,
        '-e',
        'process.stdout.write("€€€€€€€€")',
      );
      const stdout = await readFile(path.join(out, 'stdout.txt'), 'utf8');
      expect(stdout).not.toContain('\uFFFD');
      const [truncation] = (await record(out)).processing.truncation;
      expect(truncation.droppedBytes + truncation.keptBytes).toBe(24);
      expect(stdout).toContain(`${truncation.droppedBytes} bytes truncated`);
    });

    it('records a command that never started', async () => {
      const out = path.join(dir, 'missing');
      await run('evidence', 'capture', '--out', out, '--', 'lh-no-such-command-xyz');
      expect((await record(out)).execution).toMatchObject({
        error: expect.stringContaining('ENOENT'),
        exitCode: null,
        outcome: 'spawn_failed',
      });
    });

    it('redacts before writing, so the raw secret never reaches the bundle', async () => {
      const out = path.join(dir, 'secret');
      vi.stubEnv('LH_TEST_API_KEY', 'super-secret-value-1');
      await run(
        'evidence',
        'capture',
        '--out',
        out,
        '--',
        node,
        '-e',
        'console.log(process.env.LH_TEST_API_KEY)',
      );
      vi.unstubAllEnvs();
      for (const name of ['stdout.txt', 'transcript.txt', 'terminal.json'])
        expect(await readFile(path.join(out, name), 'utf8')).not.toContain('super-secret-value-1');
      expect((await record(out)).processing.redactions).toContainEqual({
        count: 1,
        rule: 'env-secret',
      });
    });

    it.skipIf(process.platform === 'win32' || 'bun' in process.versions)(
      'records a pty session as a replayable asciicast v3',
      async () => {
        const out = path.join(dir, 'pty');
        await run(
          'evidence',
          'capture',
          '--mode',
          'pty',
          '--cols',
          '50',
          '--rows',
          '7',
          '--out',
          out,
          '--',
          node,
          '-e',
          'process.stdout.write("\\u001b[32mgreen\\u001b[0m\\r\\n"); process.exit(2)',
        );
        const terminal = await record(out);
        expect(terminal).toMatchObject({
          capture: {
            mode: 'pty',
            streamLayout: 'merged',
            terminal: { cols: 50, rows: 7 },
            timing: 'recorded',
          },
          execution: { exitCode: 2, outcome: 'exited' },
        });
        const cast = parseAsciicast(await readFile(path.join(out, 'session.cast'), 'utf8'));
        expect(cast).toMatchObject({ cols: 50, exitStatus: 2, rows: 7, version: 3 });
        expect(cast.events.some((e) => e.code === 'o' && e.data.includes('green'))).toBe(true);
        expect(await readFile(path.join(out, 'output.txt'), 'utf8')).toBe('green\n');
      },
    );

    it('refuses to overwrite a bundle without --force, and never clears other files', async () => {
      const out = path.join(dir, 'twice');
      await run('evidence', 'capture', '--out', out, '--', node, '-e', '0');
      await expect(run('evidence', 'capture', '--out', out, '--', node, '-e', '0')).rejects.toThrow(
        'exit 1',
      );
      expect(errors.join('\n')).toContain('--force');
      await run('evidence', 'capture', '--force', '--out', out, '--', node, '-e', '0');

      await writeFile(path.join(dir, 'notes.md'), 'keep me');
      await expect(
        run('evidence', 'capture', '--force', '--out', dir, '--', node, '-e', '0'),
      ).rejects.toThrow('exit 1');
      expect(existsSync(path.join(dir, 'notes.md'))).toBe(true);
    });
  });

  describe('import', () => {
    it('keeps unknown facts unknown and never runs the command', async () => {
      await writeFile(path.join(dir, 'tool.log'), '\u001B[32mDone\u001B[0m, all good\n');
      const out = path.join(dir, 'imported');
      await run(
        'evidence',
        'import',
        '--out',
        out,
        '--input',
        path.join(dir, 'tool.log'),
        '--command',
        'rm -rf /definitely-not-run',
        '--tool',
        'Bash',
      );
      const terminal = await record(out);
      expect(terminal).toMatchObject({
        capture: { mode: 'import', streamLayout: 'merged', timing: 'unavailable' },
        execution: { exitCode: null, outcome: 'unknown', startedAt: null },
        source: { kind: 'imported', originalTool: 'Bash' },
      });
      expect(terminal.processing.missingFields).toEqual(
        expect.arrayContaining(['execution.exitCode', 'execution.startedAt', 'execution.cwd']),
      );
      expect(terminal.processing.notes).toContain(
        'Removed terminal control sequences from --input.',
      );
      expect(await readFile(path.join(out, 'output.txt'), 'utf8')).toBe('Done, all good\n');
    });

    it('uses the facts a recording carries and says so', async () => {
      await writeFile(
        path.join(dir, 'rec.cast'),
        [
          JSON.stringify({
            command: 'make',
            term: { cols: 20, rows: 4 },
            timestamp: 1_700_000_000,
            version: 3,
          }),
          JSON.stringify([0.5, 'o', 'built\r\n']),
          JSON.stringify([0.1, 'i', 'typed-password']),
          JSON.stringify([0.2, 'x', '0']),
        ].join('\n'),
      );
      const out = path.join(dir, 'rec');
      await run('evidence', 'import', '--out', out, '--cast', path.join(dir, 'rec.cast'));
      const terminal = await record(out);
      expect(terminal).toMatchObject({
        capture: { terminal: { cols: 20, rows: 4 }, timing: 'recorded' },
        execution: {
          command: 'make',
          exitCode: 0,
          outcome: 'exited',
          startedAt: '2023-11-14T22:13:20.000Z',
        },
      });
      expect(terminal.processing.notes).toEqual(
        expect.arrayContaining([
          'execution.exitCode taken from the recording exit event.',
          'Dropped recorded keyboard input events.',
        ]),
      );
      expect(await readFile(path.join(out, 'session.cast'), 'utf8')).not.toContain(
        'typed-password',
      );
    });

    it('refuses a broken recording instead of publishing an unplayable one', async () => {
      await writeFile(path.join(dir, 'bad.cast'), '{"version":3,"term":{"cols":5,"rows":5}}\nnope');
      await expect(
        run(
          'evidence',
          'import',
          '--out',
          path.join(dir, 'bad'),
          '--cast',
          path.join(dir, 'bad.cast'),
        ),
      ).rejects.toThrow('exit 1');
      expect(errors.join('\n')).toContain('line 2');
    });
  });

  describe('publishing', () => {
    const captureBundle = async (name: string, ...extra: string[]) => {
      const out = path.join(dir, name);
      await run(
        'evidence',
        'capture',
        ...extra,
        '--out',
        out,
        '--',
        node,
        '-e',
        'console.log("ok")',
      );
      return out;
    };

    it('uploads each artifact, names its file id in the record, and inlines a short transcript', async () => {
      const out = await captureBundle('pub');
      const payload = await publishTerminalBundle(
        async (file) => ({ id: `id-${path.basename(file)}` }),
        out,
      );
      expect(payload).toMatchObject({
        content: expect.stringContaining('--- stdout ---\nok'),
        description: expect.stringMatching(/^\$ /),
        fileId: undefined,
        type: 'terminal',
      });
      expect(payload.metadata.terminal.artifacts.stdout).toMatchObject({
        fileId: 'id-stdout.txt',
        path: 'stdout.txt',
      });
      // The bundle on disk is unchanged by publishing.
      expect((await record(out)).artifacts.stdout.fileId).toBeUndefined();
    });

    it('refuses a bundle edited after it was written', async () => {
      const out = await captureBundle('edited');
      await appendFile(path.join(out, 'stdout.txt'), 'all tests passed\n');
      await expect(publishTerminalBundle(async () => ({ id: 'x' }), out)).rejects.toThrow(
        /changed after the bundle was written/,
      );
    });

    it('refuses a bundle whose transcript was edited after it was written', async () => {
      const out = await captureBundle('edited-transcript');
      await appendFile(path.join(out, 'transcript.txt'), 'all tests passed\n');
      await expect(publishTerminalBundle(async () => ({ id: 'x' }), out)).rejects.toThrow(
        /transcript\.txt does not match/,
      );
    });

    it('refuses a bundle whose record was edited after it was written', async () => {
      const out = await captureBundle('edited-record');
      const terminal = await record(out);
      terminal.execution.exitCode = 0;
      terminal.execution.command = 'npm test';
      await writeFile(path.join(out, 'terminal.json'), JSON.stringify(terminal));
      await expect(publishTerminalBundle(async () => ({ id: 'x' }), out)).rejects.toThrow(
        /transcript\.txt does not match/,
      );
    });

    it('submits a terminal bundle atomically with the verdict', async () => {
      const out = await captureBundle('submit');
      await run(
        'result',
        'submit',
        '--run',
        'run-1',
        '--item',
        'cli-list',
        '--verdict',
        'passed',
        '--terminal',
        out,
      );
      expect(client.verify.submitCheckEvidence.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          checkItemId: 'cli-list',
          evidence: [
            expect.objectContaining({
              capturedBy: 'cli',
              metadata: {
                terminal: expect.objectContaining({
                  source: { kind: 'captured', originalRecordRef: null, originalTool: null },
                }),
              },
              type: 'terminal',
            }),
          ],
          verdict: 'passed',
        }),
      );
      expect(uploads).toEqual(['stdout.txt']);
    });

    it('attaches a bundle with evidence upload --terminal', async () => {
      const out = await captureBundle('upload');
      await run('evidence', 'upload', '--check', 'result-1', '--terminal', out);
      expect(client.verify.uploadEvidence.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ checkResultId: 'result-1', type: 'terminal' }),
      );
    });

    it('keeps a before/after comparison on terminal bundles so the pair renders together', async () => {
      const before = await captureBundle('cmp-before');
      const after = await captureBundle('cmp-after');
      await writeFile(
        path.join(dir, 'result.json'),
        JSON.stringify({
          cases: [
            {
              evidence: [
                {
                  comparison: { id: 'feedback', layout: 'vertical', role: 'before' },
                  description: 'before',
                  path: path.basename(before),
                },
                {
                  comparison: { id: 'feedback', layout: 'vertical', role: 'after' },
                  description: 'after',
                  path: path.basename(after),
                },
              ],
              id: 'pair',
              status: 'passed',
              title: 'pair',
            },
          ],
          plan: [{ id: 'pair', title: 'pair' }],
          summary: { verdict: 'passed' },
          title: 'pair',
        }),
      );

      await run('ingest', dir, '--json');

      const metadata = client.verify.uploadEvidence.mutate.mock.calls.map(
        ([input]) => input.metadata,
      );
      expect(metadata).toEqual([
        expect.objectContaining({
          comparison: { id: 'feedback', layout: 'vertical', role: 'before' },
          terminal: expect.objectContaining({ version: 1 }),
        }),
        expect.objectContaining({
          comparison: { id: 'feedback', layout: 'vertical', role: 'after' },
        }),
      ]);
    });

    it('ingests a bundle path as terminal evidence and gates execution requirements on provenance', async () => {
      const captured = await captureBundle('ingest-captured');
      await writeFile(path.join(dir, 'example.txt'), '$ lh agent list\nagent-1\n');
      await run(
        'evidence',
        'import',
        '--out',
        path.join(dir, 'ingest-example'),
        '--input',
        path.join(dir, 'example.txt'),
        '--source',
        'authored',
      );
      const required = [{ provenance: 'execution', type: 'terminal' }];
      await writeFile(
        path.join(dir, 'result.json'),
        JSON.stringify({
          cases: [
            { evidence: [path.basename(captured)], id: 'real', status: 'passed', title: 'real' },
            {
              evidence: ['ingest-example/terminal.json'],
              id: 'example',
              status: 'passed',
              title: 'example',
            },
          ],
          plan: [
            { id: 'real', requiredEvidence: required, title: 'real run' },
            { id: 'example', requiredEvidence: required, title: 'example only' },
          ],
          summary: { verdict: 'passed' },
          title: 'cli acceptance',
        }),
      );

      await run('ingest', dir, '--json');

      const uploaded = client.verify.uploadEvidence.mutate.mock.calls.map(([input]) => input);
      expect(uploaded.map((input) => [input.checkResultId, input.type])).toEqual([
        ['result-real', 'terminal'],
        ['result-example', 'terminal'],
      ]);
      const out = JSON.parse(printed.at(-1)!);
      expect(out.missingEvidence).toEqual([{ checkItemId: 'example', types: ['terminal'] }]);
      expect(client.verify.ingestResult.mutate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          checkItemId: 'example',
          toulmin: expect.objectContaining({
            limitation: 'Required evidence not published: terminal from a real command execution.',
          }),
          verdict: 'uncertain',
        }),
      );
    });
  });
});
