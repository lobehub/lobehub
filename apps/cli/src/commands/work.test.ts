import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWorkCommand } from './work';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  lookup: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    work: {
      createAgentWork: { mutate: mocks.create },
      deleteAgentWork: { mutate: mocks.delete },
      lookupPullRequest: { query: mocks.lookup },
      updateAgentWork: { mutate: mocks.update },
    },
    workspace: { getById: { query: mocks.workspace } },
  }),
}));
vi.mock('../utils/uploadLocalFile', () => ({ uploadLocalFile: mocks.upload }));

const url = 'https://github.com/owner/repo/pull/12/files';
const topics = [
  { agentId: 'agt_a', groupId: null, title: 'Implementation', topicId: 'tpc_a' },
  { agentId: null, groupId: 'grp_b', title: 'Review', topicId: 'tpc_b' },
];

const lookup = async (...args: string[]) => {
  const program = new Command().exitOverride();
  registerWorkCommand(program);
  await program.parseAsync(['work', 'lookup', url, ...args], { from: 'user' });
};

describe('work lookup', () => {
  beforeEach(() => {
    mocks.lookup.mockReset();
    mocks.workspace.mockReset();
    mocks.lookup.mockResolvedValue({ data: topics });
    mocks.workspace.mockResolvedValue({ slug: 'team' });
    vi.stubEnv('LOBEHUB_SERVER', 'https://app.example.com');
    vi.stubEnv('LOBEHUB_WORKSPACE_ID', 'workspace-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('outputs all conversations with scoped agent and group URLs in JSON', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    await lookup('--json');

    expect(mocks.lookup).toHaveBeenCalledWith({ url });
    const [json] = out.mock.calls[0];
    expect(JSON.parse(json)).toEqual([
      { ...topics[0], url: 'https://app.example.com/team/agent/agt_a/tpc_a' },
      { ...topics[1], url: 'https://app.example.com/team/group/grp_b/tpc_b' },
    ]);
  });

  it('prints one row per conversation in the terminal', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    await lookup();

    expect(out).toHaveBeenCalledTimes(3);
    expect(out.mock.calls[1][0]).toMatch(
      /Implementation +https:\/\/app\.example\.com\/team\/agent\/agt_a\/tpc_a/,
    );
    expect(out.mock.calls[2][0]).toMatch(
      /Review +https:\/\/app\.example\.com\/team\/group\/grp_b\/tpc_b/,
    );
  });

  it('prints a useful empty state and an empty JSON array', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.lookup.mockResolvedValue({ data: [] });

    await lookup();
    await lookup('--json');

    expect(out.mock.calls).toEqual([
      ['No linked conversations found in the current workspace.'],
      ['[]'],
    ]);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});

const runWork = async (...args: string[]) => {
  const program = new Command().exitOverride();
  registerWorkCommand(program);
  await program.parseAsync(['work', ...args], { from: 'user' });
};

describe('work create / update', () => {
  const created = { id: 'work_1', title: 'report.pdf', url: 'https://app.example.com/f/file_1' };

  beforeEach(() => {
    for (const mock of [mocks.create, mocks.update, mocks.upload]) mock.mockReset();
    mocks.create.mockResolvedValue(created);
    mocks.update.mockResolvedValue(created);
    mocks.upload.mockResolvedValue({ id: 'file_1' });
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op_run');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uploads a file as the run output and registers it by absolute path', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runWork('create', '--file', 'out/report.pdf', '--description', 'Q3 numbers');

    const absolutePath = path.resolve('out/report.pdf');
    expect(mocks.upload).toHaveBeenCalledWith(expect.anything(), absolutePath, {
      source: 'tool-result',
    });
    expect(mocks.create).toHaveBeenCalledWith({
      description: 'Q3 numbers',
      fileId: 'file_1',
      filePath: absolutePath,
      operationId: 'op_run',
      title: undefined,
      type: 'file',
    });
    expect(out).toHaveBeenCalledWith('Created Work work_1: report.pdf');
  });

  it('registers a link with its title and prints JSON', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runWork(
      'create',
      '--url',
      'https://preview.example.com',
      '--title',
      'Preview',
      '--operation',
      'op_flag',
      '--json',
    );

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({
      description: undefined,
      operationId: 'op_flag',
      title: 'Preview',
      type: 'link',
      url: 'https://preview.example.com',
    });
    expect(JSON.parse(out.mock.calls[0][0])).toEqual(created);
  });

  it.each([
    [['create'], 'Pass exactly one of --file or --url'],
    [['create', '--file', 'a.pdf', '--url', 'https://x.example.com'], 'Pass exactly one'],
    [['create', '--url', 'https://x.example.com'], '--title is required with --url'],
    [['update', 'work_1'], 'Pass at least one of'],
  ])('rejects %j before calling the server', async (args, message) => {
    await expect(runWork(...args)).rejects.toThrow(message);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('needs a running operation', async () => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', '');
    await expect(runWork('create', '--file', 'a.pdf')).rejects.toThrow('--operation');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('updates a Work with a newly uploaded file and leaves other fields out', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runWork('update', 'work_1', '--file', 'out/report.pdf');

    expect(mocks.update).toHaveBeenCalledWith({
      description: undefined,
      fileId: 'file_1',
      operationId: 'op_run',
      title: undefined,
      workId: 'work_1',
    });
  });
});

describe('work delete', () => {
  beforeEach(() => {
    mocks.delete.mockReset();
    mocks.delete.mockResolvedValue({ id: 'work_1', title: 'Wrong shelf' });
    vi.stubEnv('LOBEHUB_OPERATION_ID', 'op_run');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('deletes the Work under the running operation', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runWork('delete', 'work_1');

    expect(mocks.delete).toHaveBeenCalledWith({ operationId: 'op_run', workId: 'work_1' });
    expect(out).toHaveBeenCalledWith('Deleted Work work_1: Wrong shelf');
  });

  it('needs a running operation', async () => {
    vi.stubEnv('LOBEHUB_OPERATION_ID', '');
    await expect(runWork('delete', 'work_1')).rejects.toThrow('--operation');
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
