import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, vi } from 'vitest';

import { getTrpcClient } from '../../../api/client';
import { resolveServerUrl } from '../../../settings';
import { log } from '../../../utils/logger';
import { uploadLocalFile } from '../../../utils/uploadLocalFile';
import { attachAcceptanceRunCommands } from '.';

/**
 * The shared harness of the `lh acceptance run` publication tests: a mocked
 * tRPC client, a temp report directory with fixture artifacts, captured stdout,
 * and the command runner. Call it inside a `describe`; each test file keeps its
 * own `vi.mock` calls (`../../../api/client`, `../../../settings`,
 * `../../../utils/uploadLocalFile`), since Vitest hoists them per file.
 */
export const usePublicationHarness = () => {
  const client = {
    acceptanceComment: { create: { mutate: vi.fn() } },
    acceptance: {
      attachRun: { mutate: vi.fn() },
      ensure: { mutate: vi.fn() },
      getBundle: { query: vi.fn() },
      linkPullRequest: { mutate: vi.fn() },
      setProject: { mutate: vi.fn() },
    },
    project: { find: { query: vi.fn() } },
    verify: {
      createRun: { mutate: vi.fn() },
      getRun: { query: vi.fn() },
      getVerifyState: { query: vi.fn() },
      ingestResult: { mutate: vi.fn() },
      submitCheckEvidence: { mutate: vi.fn() },
      uploadEvidence: { mutate: vi.fn() },
      upsertReport: { mutate: vi.fn() },
    },
    user: { getUserState: { query: vi.fn() } },
    workspace: { getById: { query: vi.fn() } },
  };
  const state = { dir: '', printed: [] as string[] };
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    vi.resetAllMocks();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    state.printed = [];
    vi.spyOn(console, 'log').mockImplementation((line) => state.printed.push(String(line)));
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    // This repository declares a project in `.agents/acceptance/config.json`;
    // run outside it so a suite only sees the project it declares itself.
    vi.spyOn(process, 'cwd').mockReturnValue(tmpdir());
    vi.mocked(resolveServerUrl).mockReturnValue('https://app.lobehub.com');
    vi.mocked(getTrpcClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof getTrpcClient>>,
    );
    vi.mocked(uploadLocalFile).mockResolvedValue({ id: 'file-1', url: 'https://files.test/1' });
    client.acceptance.ensure.mutate.mockResolvedValue({ id: 'acceptance-1' });
    client.acceptance.getBundle.query.mockResolvedValue({});
    client.acceptance.attachRun.mutate.mockResolvedValue({ id: 'run-1', roundIndex: 2 });
    client.verify.createRun.mutate.mockResolvedValue({ id: 'run-1' });
    client.verify.ingestResult.mutate.mockImplementation(async (input) => ({
      id: `result-${input.checkItemId}`,
    }));
    client.verify.uploadEvidence.mutate.mockResolvedValue({ id: 'evidence-1' });
    client.user.getUserState.query.mockResolvedValue({
      settings: { general: { responseLanguage: 'en-US' } },
    });
    state.dir = await mkdtemp(path.join(tmpdir(), 'lh-evidence-'));
    await writeFile(path.join(state.dir, "screen's shot.png"), 'image fixture');
    await writeFile(path.join(state.dir, 'scroll.mp4'), 'video fixture');
    await writeFile(path.join(state.dir, 'output.txt'), 'Observed the expected response.');
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(state.dir, { force: true, recursive: true });
  });

  const run = async (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    attachAcceptanceRunCommands(program.command('acceptance'));
    await program.parseAsync(['node', 'lh', 'acceptance', 'run', ...args]);
  };

  const report = async (requiredEvidence: string[], evidence: string[], verdict = 'passed') => {
    await writeFile(
      path.join(state.dir, 'result.json'),
      JSON.stringify({
        cases: [{ evidence, id: 'screen', name: '用户能看到处理结果', status: verdict }],
        plan: [{ id: 'screen', requiredEvidence, title: '用户能看到处理结果' }],
        summary: { passed: 1, total: 1, verdict },
        title: '处理结果展示',
      }),
    );
  };

  const result = () => JSON.parse(state.printed.at(-1)!);
  const finalCheck = () => client.verify.ingestResult.mutate.mock.calls.at(-1)![0];
  const finalReport = () => client.verify.upsertReport.mutate.mock.calls.at(-1)![0];

  return {
    client,
    finalCheck,
    finalReport,
    get dir() {
      return state.dir;
    },
    get printed() {
      return state.printed;
    },
    report,
    result,
    run,
  };
};
