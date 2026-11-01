import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDashboardCommand } from './dashboard';
import { registerWidgetCommand } from './widget';

const { mockClient, mockConfirm } = vi.hoisted(() => ({
  mockClient: {
    dashboard: {
      addItem: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      detail: { query: vi.fn() },
      list: { query: vi.fn() },
      listByProject: { query: vi.fn() },
    },
    widget: {
      create: { mutate: vi.fn() },
      detail: { query: vi.fn() },
      dryRun: { mutate: vi.fn() },
      getRun: { query: vi.fn() },
      getVersion: { query: vi.fn() },
      list: { query: vi.fn() },
      listByProject: { query: vi.fn() },
      listRuns: { query: vi.fn() },
      publish: { mutate: vi.fn() },
      run: { mutate: vi.fn() },
      saveDraft: { mutate: vi.fn() },
      setSchedule: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
    },
    workspace: { getById: { query: vi.fn() } },
  },
  mockConfirm: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));
const { mockResolveWorkspaceId } = vi.hoisted(() => ({ mockResolveWorkspaceId: vi.fn() }));
vi.mock('../api/workspace', () => ({ resolveWorkspaceId: mockResolveWorkspaceId }));
vi.mock('../settings', () => ({ resolveServerUrl: () => 'https://app.example.com' }));
vi.mock('../utils/logger', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/format', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirm: mockConfirm,
}));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerWidgetCommand(program);
  registerDashboardCommand(program);
  return program.parseAsync(['node', 'test', ...args]);
};

const draftVersion = {
  id: 'ver-1',
  manifest: { network: { allow: ['api.github.com'] } },
  outputType: 'stat',
  runtime: 'node',
  script: 'console.log(1)',
  version: 1,
  view: null,
};

describe('widget command', () => {
  let logs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    logs = [];
    // A closed draft (no credentials, no network) by default; risky cases override it.
    const closed = { id: 'ver-1', manifest: null };
    mockClient.widget.getVersion.query.mockResolvedValue({ data: closed });
    mockClient.widget.detail.query.mockResolvedValue({
      data: { draftVersion: closed, publishedVersion: null },
    });
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('creates a widget owned by the given agent and placed on a board', async () => {
    mockClient.widget.create.mutate.mockResolvedValue({ data: { id: 'w-1' } });
    await run(
      'widget',
      'create',
      '-t',
      'Open bugs',
      '-d',
      'Bug issues',
      '--agent',
      'agt_1',
      '--dashboard',
      'd-1',
    );
    expect(mockClient.widget.create.mutate).toHaveBeenCalledWith({
      agentId: 'agt_1',
      dashboardId: 'd-1',
      description: 'Bug issues',
      projectId: undefined,
      title: 'Open bugs',
    });
  });

  it('keeps the current draft values for fields a new draft omits', async () => {
    mockClient.widget.detail.query.mockResolvedValue({
      data: { draftVersion, publishedVersion: null },
    });
    mockClient.widget.saveDraft.mutate.mockResolvedValue({ data: { id: 'ver-2', version: 2 } });

    await run('widget', 'draft', 'w-1', '--script', 'console.log(2)', '--note', 'fix');

    expect(mockClient.widget.saveDraft.mutate).toHaveBeenCalledWith({
      changeNote: 'fix',
      manifest: draftVersion.manifest,
      outputType: 'stat',
      runtime: 'node',
      script: 'console.log(2)',
      view: null,
      widgetId: 'w-1',
    });
  });

  it('refuses a first draft without a script, runtime and output type', async () => {
    mockClient.widget.detail.query.mockResolvedValue({
      data: { draftVersion: null, publishedVersion: null },
    });
    await run('widget', 'draft', 'w-1', '--script', 'echo 1');
    expect(mockClient.widget.saveDraft.mutate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('prints a failed dry run with its logs and exits non-zero', async () => {
    mockClient.widget.dryRun.mutate.mockResolvedValue({
      data: { error: { code: 'EXIT' }, id: 'run-1', status: 'failed', stderr: 'boom' },
    });
    await run('widget', 'dry-run', 'w-1', '--version', 'ver-1');
    expect(mockClient.widget.dryRun.mutate).toHaveBeenCalledWith({
      versionId: 'ver-1',
      widgetId: 'w-1',
    });
    expect(logs.join('\n')).toContain('boom');
    expect(process.exitCode).toBe(1);
  });

  it('exits non-zero for a failed dry run with --json too', async () => {
    mockClient.widget.dryRun.mutate.mockResolvedValue({ data: { id: 'run-1', status: 'timeout' } });
    await run('widget', 'dry-run', 'w-1', '--json');
    expect(process.exitCode).toBe(1);
  });

  it('treats a partial dry run as usable, like the publish gate does', async () => {
    mockClient.widget.dryRun.mutate.mockResolvedValue({ data: { id: 'run-1', status: 'partial' } });
    await run('widget', 'dry-run', 'w-1', '--json');
    expect(process.exitCode).toBeUndefined();
  });

  describe('dry-run of a credentialed or networked draft', () => {
    const risky = {
      id: 'ver-2',
      manifest: {
        env: [{ connector: 'github', name: 'GITHUB_TOKEN' }],
        network: { allow: ['api.github.com'] },
      },
    };
    let isTTY: PropertyDescriptor | undefined;

    beforeEach(() => {
      mockClient.widget.getVersion.query.mockResolvedValue({ data: risky });
      mockClient.widget.detail.query.mockResolvedValue({
        data: { draftVersion: risky, publishedVersion: null },
      });
      mockClient.widget.dryRun.mutate.mockResolvedValue({
        data: { id: 'run-1', status: 'succeeded' },
      });
      isTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    });

    afterEach(() => {
      if (isTTY) Object.defineProperty(process.stdin, 'isTTY', isTTY);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    });

    it('refuses to run without the user’s approval and says what to show them', async () => {
      await run('widget', 'dry-run', 'w-1', '--version', 'ver-2');
      expect(mockClient.widget.dryRun.mutate).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const { log } = await import('../utils/logger');
      expect(vi.mocked(log.error).mock.calls[0][0]).toMatch(
        /GITHUB_TOKEN \(github\).*api\.github\.com.*--version ver-2 --yes/,
      );
    });

    it('refuses --yes without the exact version the approval covers', async () => {
      await run('widget', 'dry-run', 'w-1', '--yes');
      expect(mockClient.widget.dryRun.mutate).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('runs the approved exact version with --version and --yes', async () => {
      await run('widget', 'dry-run', 'w-1', '--version', 'ver-2', '--yes');
      expect(mockClient.widget.dryRun.mutate).toHaveBeenCalledWith({
        versionId: 'ver-2',
        widgetId: 'w-1',
      });
    });

    it('asks interactively in a terminal', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
      mockConfirm.mockResolvedValue(false);
      await run('widget', 'dry-run', 'w-1', '--version', 'ver-2');
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockClient.widget.dryRun.mutate).not.toHaveBeenCalled();
    });
  });

  it('exits non-zero when a manual refresh fails', async () => {
    mockClient.widget.run.mutate.mockResolvedValue({ data: { id: 'run-1', status: 'failed' } });
    await run('widget', 'run', 'w-1', '--json');
    expect(process.exitCode).toBe(1);
  });

  it('treats a partial manual refresh as usable', async () => {
    mockClient.widget.run.mutate.mockResolvedValue({ data: { id: 'run-1', status: 'partial' } });
    await run('widget', 'run', 'w-1');
    expect(process.exitCode).toBeUndefined();
  });

  it('does not publish when the confirmation is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    await run('widget', 'publish', 'w-1', '--version', 'ver-1');
    expect(mockClient.widget.publish.mutate).not.toHaveBeenCalled();
  });

  it('publishes the exact version with --yes and fills the card right away', async () => {
    mockClient.widget.publish.mutate.mockResolvedValue({ data: { version: { version: 3 } } });
    mockClient.widget.run.mutate.mockResolvedValue({ data: { status: 'succeeded' } });
    await run('widget', 'publish', 'w-1', '--version', 'ver-3', '--yes');
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockClient.widget.publish.mutate).toHaveBeenCalledWith({
      versionId: 'ver-3',
      widgetId: 'w-1',
    });
    expect(mockClient.widget.run.mutate).toHaveBeenCalledWith({ widgetId: 'w-1' });
  });

  it('clears the schedule with "off"', async () => {
    mockClient.widget.setSchedule.mutate.mockResolvedValue({ data: {} });
    await run('widget', 'schedule', 'w-1', 'off');
    expect(mockClient.widget.setSchedule.mutate).toHaveBeenCalledWith({
      id: 'w-1',
      pattern: null,
      timezone: undefined,
    });
  });
});

describe('dashboard command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    mockResolveWorkspaceId.mockReturnValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('lists a project’s boards', async () => {
    mockClient.dashboard.listByProject.query.mockResolvedValue({ data: [] });
    await run('dashboard', 'list', '--project', 'prj_1');
    expect(mockClient.dashboard.listByProject.query).toHaveBeenCalledWith({ projectId: 'prj_1' });
  });

  it('creates a board inside a project with a widget on it', async () => {
    mockClient.dashboard.create.mutate.mockResolvedValue({
      data: { id: 'd-1', projectId: 'prj_1', title: 'Ops' },
    });
    await run('dashboard', 'create', '-t', 'Ops', '--project', 'prj_1', '--widget', 'w-1');
    expect(mockClient.dashboard.create.mutate).toHaveBeenCalledWith({
      description: undefined,
      projectId: 'prj_1',
      title: 'Ops',
      widgetId: 'w-1',
    });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('https://app.example.com/project/prj_1/dashboard/d-1'),
    );
  });

  it('refuses a project-less board in a workspace, where it could not be opened', async () => {
    mockResolveWorkspaceId.mockReturnValue('ws_1');
    await run('dashboard', 'create', '-t', 'Ops');
    expect(mockClient.dashboard.create.mutate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('creates a project board in a workspace', async () => {
    mockResolveWorkspaceId.mockReturnValue('ws_1');
    mockClient.workspace.getById.query.mockResolvedValue({ slug: 'team' });
    mockClient.dashboard.create.mutate.mockResolvedValue({
      data: { id: 'd-1', projectId: 'prj_1', title: 'Ops' },
    });
    await run('dashboard', 'create', '-t', 'Ops', '--project', 'prj_1');
    expect(mockClient.dashboard.create.mutate).toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('places a widget on a board', async () => {
    mockClient.dashboard.addItem.mutate.mockResolvedValue({ data: {} });
    await run('dashboard', 'add', 'd-1', 'w-1');
    expect(mockClient.dashboard.addItem.mutate).toHaveBeenCalledWith({
      dashboardId: 'd-1',
      widgetId: 'w-1',
    });
  });
});
