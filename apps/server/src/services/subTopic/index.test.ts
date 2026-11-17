// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SubTopicDeps, SubTopicError, SubTopicService } from './index';

const opener = {
  agentId: 'agt_lobe',
  id: 'tpc_parent',
  metadata: {
    boundDeviceId: 'dev_mac',
    workingDirectory: '/Users/me/.lobehub/worktrees/repo/quiet-hill',
    workingDirectoryConfig: {
      git: {
        activeWorktree: '/Users/me/.lobehub/worktrees/repo/quiet-hill',
        autoCreated: true,
        autoCreatedAt: '2026-11-17T00:00:00.000Z',
        branch: 'lobehub/quiet-hill',
        isWorktree: true,
      },
      path: '/Users/me/repo',
      repoType: 'github',
    },
  },
  status: 'active',
};

const createDeps = () =>
  ({
    addGitWorktree: vi.fn().mockResolvedValue({
      success: true,
      worktreePath: '/Users/me/.lobehub/worktrees/repo/brave-river',
    }),
    appendFollowUp: vi.fn().mockResolvedValue({ queued: false, reason: 'idle' }),
    archiveTopic: vi.fn().mockResolvedValue(undefined),
    detachTopics: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        agentId: id === 'tpc_cross' ? 'agt_codex' : 'agt_lobe',
        id,
        trigger: null,
      })),
    ),
    execAgent: vi
      .fn()
      .mockResolvedValue({ operationId: 'op_child', success: true, topicId: 'tpc_new' }),
    findLiveRunIds: vi.fn().mockResolvedValue([]),
    findTopic: vi.fn(async (id: string) => {
      if (id === 'tpc_parent') return opener;
      if (id === 'tpc_run') return { agentId: 'agt_lobe', id, trigger: 'task' };
      if (id === 'tpc_cross')
        return { agentId: 'agt_codex', id, metadata: { openedBy: { topicId: 'tpc_parent' } } };
      if (id === 'tpc_same')
        return { agentId: 'agt_lobe', id, metadata: { openedBy: { topicId: 'tpc_parent' } } };
      return undefined;
    }),
    interrupt: vi.fn().mockResolvedValue(undefined),
    listDescendants: vi.fn().mockResolvedValue([]),
    listOpened: vi.fn().mockResolvedValue([]),
    readLastReply: vi.fn().mockResolvedValue('Done.'),
    resolveInterventionConfig: vi.fn().mockResolvedValue({ approvalMode: 'auto-run' }),
    startOnTopic: vi.fn().mockResolvedValue({ operationId: 'op_turn', success: true }),
    trashTopic: vi.fn().mockResolvedValue(undefined),
  }) satisfies SubTopicDeps;

describe('SubTopicService.open', () => {
  let deps: ReturnType<typeof createDeps>;
  beforeEach(() => {
    deps = createDeps();
  });

  it('opens a sub_topic topic linked to the opener, sharing its directory without owning it', async () => {
    const result = await new SubTopicService(deps).open({
      openerTopicId: 'tpc_parent',
      prompt: 'Fix the flaky test',
      sourceOperationId: 'op_parent',
      title: 'Flaky test',
    });

    expect(result).toEqual(
      expect.objectContaining({ agentId: 'agt_lobe', operationId: 'op_child', topicId: 'tpc_new' }),
    );
    const params = deps.execAgent.mock.calls[0][0] as any;
    expect(params).toMatchObject({
      agentId: 'agt_lobe',
      deviceId: 'dev_mac',
      openedByTopicId: 'tpc_parent',
      prompt: 'Fix the flaky test',
      sourceOperationId: 'op_parent',
      title: 'Flaky test',
      trigger: 'sub_topic',
      userInterventionConfig: { approvalMode: 'auto-run' },
    });
    const config = params.appContext.initialTopicMetadata.workingDirectoryConfig;
    expect(params.appContext.initialTopicMetadata.workingDirectory).toBe(
      '/Users/me/.lobehub/worktrees/repo/quiet-hill',
    );
    // The opener owns that worktree; the child must never clean it up.
    expect(config.git.autoCreated).toBeUndefined();
    expect(config.git.activeWorktree).toBe('/Users/me/.lobehub/worktrees/repo/quiet-hill');
  });

  it('creates and claims a new worktree from the opener repository', async () => {
    const result = await new SubTopicService(deps).open({
      agentId: 'agt_codex',
      baseBranch: 'canary',
      openerTopicId: 'tpc_parent',
      prompt: 'Try the other approach',
      workspace: 'new-worktree',
    });

    expect(deps.addGitWorktree).toHaveBeenCalledWith({
      branch: expect.stringMatching(/^lobehub\//),
      deviceId: 'dev_mac',
      path: '/Users/me/.lobehub/worktrees/repo/quiet-hill',
      sourcePath: '/Users/me/repo',
      startPoint: 'canary',
    });
    const params = deps.execAgent.mock.calls[0][0] as any;
    expect(params.agentId).toBe('agt_codex');
    expect(params.appContext.initialTopicMetadata).toEqual({
      workingDirectory: '/Users/me/.lobehub/worktrees/repo/brave-river',
      workingDirectoryConfig: {
        git: {
          activeWorktree: '/Users/me/.lobehub/worktrees/repo/brave-river',
          autoCreated: true,
          autoCreatedAt: expect.any(String),
          branch: result.branch,
          isWorktree: true,
        },
        path: '/Users/me/repo',
        repoType: 'github',
        sessionPath: '/Users/me/.lobehub/worktrees/repo/brave-river',
      },
    });
  });

  it('opens a plain, unlinked topic when asked to detach', async () => {
    await new SubTopicService(deps).open({
      agentId: 'agt_codex',
      detach: true,
      openerTopicId: 'tpc_parent',
      prompt: 'Stand-alone work',
    });

    const params = deps.execAgent.mock.calls[0][0] as any;
    expect(params.openedByTopicId).toBeUndefined();
    expect(params.trigger).toBeUndefined();
    expect(params.agentId).toBe('agt_codex');
  });

  it('refuses a new worktree without a repository on a device', async () => {
    deps.findTopic.mockResolvedValueOnce({ agentId: 'agt_lobe', id: 'tpc_parent', metadata: {} });

    await expect(
      new SubTopicService(deps).open({
        openerTopicId: 'tpc_parent',
        prompt: 'x',
        workspace: 'new-worktree',
      }),
    ).rejects.toBeInstanceOf(SubTopicError);
    expect(deps.execAgent).not.toHaveBeenCalled();
  });

  it('sets no directory when asked for no workspace, but stays on the opener device', async () => {
    await new SubTopicService(deps).open({
      openerTopicId: 'tpc_parent',
      prompt: 'x',
      workspace: 'none',
    });

    const params = deps.execAgent.mock.calls[0][0] as any;
    expect(params.appContext).toBeUndefined();
    // A device-bound agent (Claude Code) has nowhere else to run.
    expect(params.deviceId).toBe('dev_mac');
  });
});

describe('SubTopicService.send', () => {
  it('starts a turn when the sub-topic is idle', async () => {
    const deps = createDeps();
    const result = await new SubTopicService(deps).send({
      message: 'Also update the docs',
      sourceOperationId: 'op_parent',
      topicId: 'tpc_cross',
    });

    expect(result).toEqual({ delivery: 'started', operationId: 'op_turn', topicId: 'tpc_cross' });
    expect(deps.startOnTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_codex',
        appContext: { topicId: 'tpc_cross' },
        prompt: 'Also update the docs',
        sourceOperationId: 'op_parent',
      }),
    );
  });

  it("queues behind a running turn, where the user's Follow-up behavior applies", async () => {
    const deps = createDeps();
    deps.appendFollowUp.mockResolvedValue({ queued: true });

    const result = await new SubTopicService(deps).send({ message: 'x', topicId: 'tpc_cross' });

    expect(result.delivery).toBe('queued');
    expect(deps.startOnTopic).not.toHaveBeenCalled();
  });

  it('goes back to the queue when a turn started in between', async () => {
    const deps = createDeps();
    deps.startOnTopic.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'CONFLICT' }));
    deps.appendFollowUp
      .mockResolvedValueOnce({ queued: false, reason: 'idle' })
      .mockResolvedValueOnce({ queued: true });

    const result = await new SubTopicService(deps).send({ message: 'x', topicId: 'tpc_cross' });

    expect(result.delivery).toBe('queued');
    // One entry id across attempts, so a retried append is stored once.
    expect(deps.appendFollowUp.mock.calls[0][0].id).toBe(deps.appendFollowUp.mock.calls[1][0].id);
  });
});

describe('SubTopicService.stop / get', () => {
  it('interrupts every live run of the sub-topic', async () => {
    const deps = createDeps();
    deps.findLiveRunIds.mockResolvedValue(['op_a']);

    expect(await new SubTopicService(deps).stop('tpc_cross')).toEqual({
      stopped: 1,
      topicId: 'tpc_cross',
    });
    expect(deps.interrupt).toHaveBeenCalledWith('op_a');
  });

  it('reports a live run as running with the last reply', async () => {
    const deps = createDeps();
    deps.findLiveRunIds.mockResolvedValue(['op_a']);

    expect(await new SubTopicService(deps).get('tpc_cross')).toMatchObject({
      lastReply: 'Done.',
      state: 'running',
      topicId: 'tpc_cross',
    });
  });
});

describe('SubTopicService.retire', () => {
  it('stops running descendants, then archives each one before the topic itself', async () => {
    const deps = createDeps();
    deps.listDescendants.mockResolvedValue([
      // A server run leaves topics.status alone: only its operation says it is running.
      {
        id: 'tpc_same',
        latestRunStatus: 'running',
        openedBy: { topicId: 'tpc_parent' },
        status: 'active',
      },
      { id: 'tpc_cross', openedBy: { topicId: 'tpc_parent' }, status: 'active' },
      // A task run belongs to its task: it is neither stopped nor archived,
      // and neither is what it opened.
      { id: 'tpc_run', openedBy: { topicId: 'tpc_parent' }, status: 'running', trigger: 'task' },
      { id: 'tpc_under_run', openedBy: { topicId: 'tpc_run' }, status: 'active' },
    ] as any);
    deps.findLiveRunIds.mockImplementation(async (id: string) =>
      id === 'tpc_same' ? ['op_same'] : [],
    );

    const result = await new SubTopicService(deps).retire({
      action: 'archive',
      mode: 'all',
      topicId: 'tpc_parent',
    });

    expect(deps.interrupt).toHaveBeenCalledWith('op_same');
    expect(deps.archiveTopic.mock.calls.map(([id]) => id)).toEqual([
      'tpc_cross',
      'tpc_same',
      'tpc_parent',
    ]);
    expect(deps.interrupt.mock.invocationCallOrder[0]).toBeLessThan(
      deps.archiveTopic.mock.invocationCallOrder[0],
    );
    expect(result.retired).toEqual(['tpc_same', 'tpc_cross', 'tpc_parent']);
  });

  it('archives only the topic and moves its sub-topics to the top level', async () => {
    const deps = createDeps();
    deps.listOpened.mockResolvedValue([{ id: 'tpc_same' }, { id: 'tpc_cross' }] as any);

    const result = await new SubTopicService(deps).retire({
      action: 'trash',
      mode: 'self',
      topicId: 'tpc_parent',
    });

    expect(deps.detachTopics).toHaveBeenCalledWith(['tpc_same', 'tpc_cross']);
    expect(deps.trashTopic).toHaveBeenCalledWith('tpc_parent');
    expect(deps.trashTopic).toHaveBeenCalledTimes(1);
    expect(result.detached).toEqual([
      { agentId: 'agt_lobe', id: 'tpc_same', movedToOwnAgent: false, trigger: null },
      { agentId: 'agt_codex', id: 'tpc_cross', movedToOwnAgent: true, trigger: null },
    ]);
  });
});

describe('SubTopicService.detach', () => {
  it('says which sub-topics moved to their own agent list', async () => {
    const deps = createDeps();

    const result = await new SubTopicService(deps).detach(['tpc_cross', 'tpc_same']);

    expect(result.detached).toEqual([
      { agentId: 'agt_codex', id: 'tpc_cross', movedToOwnAgent: true, trigger: null },
      { agentId: 'agt_lobe', id: 'tpc_same', movedToOwnAgent: false, trigger: null },
    ]);
  });

  it('keeps task runs with their task', async () => {
    const deps = createDeps();

    await expect(new SubTopicService(deps).detach(['tpc_run'])).rejects.toBeInstanceOf(
      SubTopicError,
    );
    expect(deps.detachTopics).not.toHaveBeenCalled();
  });
});

describe('SubTopicService.describe', () => {
  it('counts what retiring the topic would touch', async () => {
    const deps = createDeps();
    deps.listDescendants.mockResolvedValue([
      {
        id: 'a',
        latestRunStatus: 'running',
        openedBy: { topicId: 'tpc_parent' },
        status: 'active',
      },
      { id: 'b', openedBy: { topicId: 'tpc_parent' }, status: 'active' },
      { id: 'c', openedBy: { topicId: 'a' }, status: 'waitingForHuman' },
      { id: 'run', openedBy: { topicId: 'tpc_parent' }, status: 'running', trigger: 'task' },
    ] as any);

    expect(await new SubTopicService(deps).describe('tpc_parent')).toEqual({
      descendants: 3,
      direct: 2,
      running: 2,
      topicId: 'tpc_parent',
    });
  });
});

describe('SubTopicService.isOpenedBy', () => {
  it('accepts a sub-topic at any depth and nothing else', async () => {
    const deps = createDeps();
    deps.findTopic.mockImplementation(async (id: string) => {
      const links: Record<string, any> = {
        tpc_child: { topicId: 'tpc_parent' },
        tpc_detached: { detachedAt: 'later', topicId: 'tpc_parent' },
        tpc_grand: { topicId: 'tpc_child' },
      };
      return links[id] ? { id, metadata: { openedBy: links[id] } } : { id, metadata: {} };
    });
    const service = new SubTopicService(deps);

    expect(await service.isOpenedBy('tpc_child', 'tpc_parent')).toBe(true);
    expect(await service.isOpenedBy('tpc_grand', 'tpc_parent')).toBe(true);
    expect(await service.isOpenedBy('tpc_detached', 'tpc_parent')).toBe(false);
    expect(await service.isOpenedBy('tpc_other', 'tpc_parent')).toBe(false);
  });
});

describe('toSubTopicState', () => {
  it("takes the latest run's state, since server runs leave topics.status alone", async () => {
    const { toSubTopicState } = await import('./index');

    expect(toSubTopicState('active', 'running')).toBe('running');
    expect(toSubTopicState(null, 'waiting_for_human')).toBe('waiting_for_user');
    expect(toSubTopicState('active', 'error')).toBe('failed');
    expect(toSubTopicState('active', 'done')).toBe('idle');
    expect(toSubTopicState('completed', 'running')).toBe('archived');
    expect(toSubTopicState('failed', null)).toBe('failed');
  });
});
