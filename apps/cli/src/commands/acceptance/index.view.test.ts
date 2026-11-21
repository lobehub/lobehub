import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrpcClient } from '../../api/client';
import { resolveWorkspaceId } from '../../api/workspace';
import { registerAcceptanceCommands } from '.';
import { ensureAcceptanceInfo } from './local/acceptanceDir';
import { createLocalAcceptance, firstRound } from './local/testUtils';

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../../api/workspace', () => ({ resolveWorkspaceId: vi.fn() }));
vi.mock('../../settings', () => ({ resolveServerUrl: () => 'https://app.lobehub.com' }));

const getBundle = vi.fn();
const getBySubject = vi.fn();
const getWorkspace = vi.fn();
let output: ReturnType<typeof vi.spyOn>;
let fixture: ReturnType<typeof createLocalAcceptance> | undefined;

const run = async (args: string[]) => {
  const program = new Command().exitOverride();
  registerAcceptanceCommands(program);
  await program.parseAsync(['node', 'lh', 'acceptance', 'view', ...args]);
  return JSON.parse(String(output.mock.calls.at(-1)?.[0]));
};

beforeEach(() => {
  vi.clearAllMocks();
  output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(resolveWorkspaceId).mockReturnValue(undefined);
  vi.mocked(getTrpcClient).mockResolvedValue({
    acceptance: { getBundle: { query: getBundle }, getBySubject: { query: getBySubject } },
    workspace: { getById: { query: getWorkspace } },
  } as unknown as Awaited<ReturnType<typeof getTrpcClient>>);
});

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('acceptance view', () => {
  it('reads a local bundle as JSON without authentication or a remote URL', async () => {
    fixture = createLocalAcceptance([firstRound()]);
    vi.stubEnv('HOME', fixture.root);
    vi.stubEnv('LOBEHUB_ACCEPTANCE_DOWNLOADS', path.join(fixture.root, 'Downloads'));
    vi.stubEnv('XDG_DOWNLOAD_DIR', path.join(fixture.root, 'Downloads'));
    vi.mocked(getTrpcClient).mockRejectedValue(new Error('Not authenticated'));
    const { info } = ensureAcceptanceInfo(fixture.acceptanceDir, 'Users can rename a topic');

    const bundle = await run([fixture.acceptanceDir, '--json']);

    expect(bundle.acceptance).toMatchObject({ id: info.id, requirement: info.requirement });
    expect(bundle.checks).toEqual([
      expect.objectContaining({
        id: 'rename',
        state: 'passed',
        title: 'Rename keeps the new title',
      }),
      expect.objectContaining({ id: 'enter', state: 'not_executed', title: 'Enter saves' }),
    ]);
    expect(bundle.rounds).toHaveLength(1);
    expect(bundle).not.toHaveProperty('url');
    expect(await run([fixture.acceptanceDir, '--json', 'acceptance,checks'])).toEqual({
      acceptance: bundle.acceptance,
      checks: bundle.checks,
    });
    expect(getTrpcClient).not.toHaveBeenCalled();
    expect(resolveWorkspaceId).not.toHaveBeenCalled();
  });

  it.each([
    { ref: 'acc_1', workspaceSlug: undefined },
    { ref: 'task:task-1', workspaceSlug: 'acme' },
  ])(
    'keeps the resolved acceptance URL when reading $ref remotely',
    async ({ ref, workspaceSlug }) => {
      const bundle = {
        acceptance: { id: 'acc_1', requirement: 'Ship it', status: 'pending' },
        checks: [],
        rounds: [],
        subject: { id: 'task-1', title: 'Ship it', type: 'task' },
      };
      getBundle.mockResolvedValue(bundle);
      getBySubject.mockResolvedValue({ id: 'acc_1' });
      if (workspaceSlug) {
        vi.mocked(resolveWorkspaceId).mockReturnValue('ws-1');
        getWorkspace.mockResolvedValue({ slug: workspaceSlug });
      }
      const url = `https://app.lobehub.com${workspaceSlug ? `/${workspaceSlug}` : ''}/acceptance/acc_1`;

      expect(await run([ref, '--json'])).toEqual({ ...bundle, url });
      expect(await run([ref, '--json', 'acceptance,url'])).toEqual({
        acceptance: bundle.acceptance,
        url,
      });
    },
  );
});
