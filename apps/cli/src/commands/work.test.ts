import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWorkCommand } from './work';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), workspace: vi.fn() }));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    work: { lookupPullRequest: { query: mocks.lookup } },
    workspace: { getById: { query: mocks.workspace } },
  }),
}));

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
