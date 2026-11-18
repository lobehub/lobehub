import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShellPullRequestLinking } from './pullRequestLinking';
import { registerShellWorks, type ShellWorkScanRecord } from './shellWorkRegistration';

/** A claude-code Bash row: its stdout + stderr arrive as the message body. */
const bashRow = (id: string, command: string, content: string): ShellWorkScanRecord => ({
  apiName: 'Bash',
  arguments: JSON.stringify({ command }),
  content,
  id,
  identifier: 'claude-code',
  toolCallId: `call-${id}`,
});

const PUSH_OUTPUT = [
  'To github.com:lobehub/lobehub.git',
  '   031bf96..f6b1c2a  feat/x -> feat/x',
].join('\n');

const createWorkModel = () =>
  ({
    registerExternal: vi.fn(async (params: { resourceId: string }) => ({ id: params.resourceId })),
    registerShellGithubResult: vi.fn(async () => ({ id: 'wk-gh' })),
  }) as any;

const createLinking = (overrides: Partial<ShellPullRequestLinking> = {}) => ({
  findOpenPullRequestsByHead: vi.fn(async () => [
    {
      headRef: 'feat/x',
      number: 12,
      repoFullName: 'lobehub/lobehub',
      title: 'Feat X',
      url: 'https://github.com/lobehub/lobehub/pull/12',
    },
  ]),
  listTopicPullRequestIds: vi.fn(async () => ['lobehub/lobehub#12']),
  ...overrides,
});

const scan = (
  records: ShellWorkScanRecord[],
  workModel: any,
  pullRequestLinking?: ShellPullRequestLinking,
) =>
  registerShellWorks({
    cumulativeCost: null,
    cumulativeUsage: null,
    operationId: 'op-1',
    pullRequestLinking,
    records,
    topicId: 'topic-1',
    workModel,
  });

describe('registerShellWorks · pull request linking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leaves pushes and lifecycle commands alone while the lab is off', async () => {
    const workModel = createWorkModel();

    await scan(
      [bashRow('m1', 'git push', PUSH_OUTPUT), bashRow('m2', 'gh pr merge 12 --squash', '')],
      workModel,
    );

    expect(workModel.registerExternal).not.toHaveBeenCalled();
    // The gh scanner still runs, exactly as before: no lifecycle option.
    expect(workModel.registerShellGithubResult).toHaveBeenCalledTimes(1);
    expect(workModel.registerShellGithubResult.mock.calls[0]).toHaveLength(1);
  });

  it('links the open pull request a push updated, from the push report', async () => {
    const workModel = createWorkModel();
    const linking = createLinking();

    const outcome = await scan([bashRow('m1', 'git push', PUSH_OUTPUT)], workModel, linking);

    expect(linking.findOpenPullRequestsByHead).toHaveBeenCalledWith('lobehub/lobehub', ['feat/x']);
    expect(workModel.registerExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: 'updated',
        messageId: 'm1',
        metadata: { headBranch: 'feat/x', pullRequestLink: 'push' },
        patchFields: ['identifier', 'title', 'url'],
        resourceId: 'lobehub/lobehub#12',
        resourceType: 'github_pull_request',
        rootOperationId: 'op-1',
        toolCallId: 'call-m1',
        topicId: 'topic-1',
      }),
    );
    expect(outcome).toMatchObject({ attempted: 1, registered: 1 });
  });

  it('reads the push report from stderr for a device runCommand', async () => {
    const workModel = createWorkModel();
    const linking = createLinking();

    await scan(
      [
        {
          apiName: 'runCommand',
          arguments: JSON.stringify({ command: 'git push' }),
          id: 'm1',
          identifier: 'lobe-local-system',
          state: { exitCode: 0, stderr: PUSH_OUTPUT, stdout: 'done' },
          toolCallId: 'call-m1',
        },
      ],
      workModel,
      linking,
    );

    expect(linking.findOpenPullRequestsByHead).toHaveBeenCalledWith('lobehub/lobehub', ['feat/x']);
  });

  it('links nothing when no tracked pull request heads the pushed branch', async () => {
    const workModel = createWorkModel();
    const linking = createLinking({ findOpenPullRequestsByHead: vi.fn(async () => []) });

    const outcome = await scan([bashRow('m1', 'git push', PUSH_OUTPUT)], workModel, linking);

    expect(workModel.registerExternal).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ attempted: 0, registered: 0 });
  });

  it('skips a failed push', async () => {
    const workModel = createWorkModel();
    const linking = createLinking();

    await scan(
      [{ ...bashRow('m1', 'git push', PUSH_OUTPUT), error: { message: 'rejected' } }],
      workModel,
      linking,
    );

    expect(linking.findOpenPullRequestsByHead).not.toHaveBeenCalled();
  });

  it('passes the lifecycle option and the topic pull requests to the gh scanner', async () => {
    const workModel = createWorkModel();
    const linking = createLinking();

    await scan([bashRow('m1', 'gh pr merge 12 --squash', '')], workModel, linking);

    expect(workModel.registerShellGithubResult).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ command: 'gh pr merge 12 --squash' }),
      }),
      { pullRequestLifecycle: true, topicPullRequests: ['lobehub/lobehub#12'] },
    );
    expect(workModel.registerShellGithubResult.mock.calls[0][0]).not.toHaveProperty('transcript');
  });

  it('only reads the topic pull requests for a bare ready / merge', async () => {
    const workModel = createWorkModel();
    const linking = createLinking();

    await scan(
      [bashRow('m1', `gh pr create --title t`, 'https://github.com/a/b/pull/1')],
      workModel,
      linking,
    );

    expect(linking.listTopicPullRequestIds).not.toHaveBeenCalled();
    expect(workModel.registerShellGithubResult).toHaveBeenCalledWith(expect.anything(), {
      pullRequestLifecycle: true,
      topicPullRequests: [],
    });
  });
});
