import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeployResumeQueueItem } from '@/database/schemas/deployResumeQueue';
import { TopicStartReservationError } from '@/server/services/aiAgent/topicStartReservation';

import { resumePendingDeployResumes, startDeployResume } from './index';
import { DEPLOY_RESUME_NOTICE, DEPLOY_RESUME_TASK_PROMPT, resumeDeployRow } from './module';

const { claim, finish, listPending, release, skipStale } = vi.hoisted(() => ({
  claim: vi.fn(),
  finish: vi.fn(),
  listPending: vi.fn(),
  release: vi.fn(),
  skipStale: vi.fn(),
}));
vi.mock('@/database/models/deployResumeQueue', () => ({
  DeployResumeQueueModel: { claim, finish, listPending, release, skipStale },
}));

const { findTopic } = vi.hoisted(() => ({ findTopic: vi.fn() }));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = findTopic;
  },
}));

const { findLiveByTopic, findOperation } = vi.hoisted(() => ({
  findLiveByTopic: vi.fn(),
  findOperation: vi.fn(),
}));
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    findById = findOperation;
    findLiveByTopic = findLiveByTopic;
  },
}));

const { createMessage, queryLastUserMessageByTopics } = vi.hoisted(() => ({
  createMessage: vi.fn(),
  queryLastUserMessageByTopics: vi.fn(),
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    create = createMessage;
    queryLastUserMessageByTopics = queryLastUserMessageByTopics;
  },
}));

const { runTask } = vi.hoisted(() => ({ runTask: vi.fn() }));
vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: class {
    runTask = runTask;
  },
}));

const { startComposerRun } = vi.hoisted(() => ({ startComposerRun: vi.fn() }));
vi.mock('@/server/services/aiAgent/composerRun', () => ({ startComposerRun }));

vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: class {} }));

const db = { query: {} } as any;

const row = (overrides: Partial<DeployResumeQueueItem> = {}): DeployResumeQueueItem =>
  ({
    attempts: 1,
    createdAt: new Date(),
    error: null,
    id: 'drq_1',
    kind: 'chat',
    operationId: 'op_1',
    payload: { lastUserMessage: '帮我继续这一步', settledAs: 'residual-chat' },
    resumedAt: null,
    status: 'running',
    taskId: null,
    topicId: 'tpc_1',
    updatedAt: new Date(),
    userId: 'user_1',
    workspaceId: null,
    ...overrides,
  }) as DeployResumeQueueItem;

const topic = (overrides: Record<string, unknown> = {}) => ({
  agentId: 'agt_1',
  groupId: null,
  id: 'tpc_1',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Chat replay is opt-in; most cases below exercise the paths behind the gate.
  vi.stubEnv('RESUME_CHAT_AFTER_DEPLOY', '1');
  findTopic.mockResolvedValue(topic());
  findOperation.mockResolvedValue({ id: 'op_1', status: 'interrupted' });
  findLiveByTopic.mockResolvedValue([]);
  createMessage.mockResolvedValue({ id: 'msg_notice' });
  queryLastUserMessageByTopics.mockResolvedValue(new Map());
  claim.mockImplementation(async (_db: unknown, id: string) => row({ id }));
  finish.mockResolvedValue(undefined);
  release.mockResolvedValue(undefined);
  skipStale.mockResolvedValue(0);
  listPending.mockResolvedValue([]);
  runTask.mockResolvedValue({ operationId: 'op_2', success: true });
  startComposerRun.mockResolvedValue({ operationId: 'op_2' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('resumePendingDeployResumes', () => {
  it('does nothing at all when RESUME_AFTER_DEPLOY=0', async () => {
    vi.stubEnv('RESUME_AFTER_DEPLOY', '0');
    listPending.mockResolvedValue([row()]);

    await expect(resumePendingDeployResumes(db)).resolves.toBe(0);

    expect(skipStale).not.toHaveBeenCalled();
    expect(listPending).not.toHaveBeenCalled();
    expect(startComposerRun).not.toHaveBeenCalled();
    expect(runTask).not.toHaveBeenCalled();
  });

  it('drops stale rows before it lists the pending ones, and never throws', async () => {
    skipStale.mockRejectedValue(new Error('relation "deploy_resume_queue" does not exist'));

    await expect(resumePendingDeployResumes(db)).resolves.toBe(0);

    expect(listPending).not.toHaveBeenCalled();
  });

  it('uses a 24h staleness window and a 20 item batch', async () => {
    await resumePendingDeployResumes(db);

    const staleBefore = skipStale.mock.calls[0][1] as Date;
    const ageHours = (Date.now() - staleBefore.getTime()) / (60 * 60 * 1000);
    expect(ageHours).toBeGreaterThan(23.9);
    expect(ageHours).toBeLessThan(24.1);
    expect(listPending).toHaveBeenCalledWith(db, { limit: 20 });
  });

  it('resumes every pending row it claimed', async () => {
    listPending.mockResolvedValue([row({ id: 'drq_1' }), row({ id: 'drq_2', topicId: 'tpc_2' })]);

    await expect(resumePendingDeployResumes(db)).resolves.toBe(2);

    expect(claim).toHaveBeenCalledTimes(2);
    expect(startComposerRun).toHaveBeenCalledTimes(2);
  });

  it('dispatches a row only once even when the queue hands it out twice', async () => {
    listPending.mockResolvedValue([row()]);
    // The second claim loses the race and gets nothing back.
    claim.mockReset();
    claim.mockResolvedValueOnce(row()).mockResolvedValue(undefined);

    await startDeployResume(db, 'drq_1');
    await startDeployResume(db, 'drq_1');

    expect(startComposerRun).toHaveBeenCalledTimes(1);
  });
});

describe('task rows', () => {
  it('continues the Task run on its original topic', async () => {
    await resumeDeployRow(
      db,
      row({ kind: 'task', payload: { settledAs: 'task-run' }, taskId: 'task_1' }),
    );

    expect(runTask).toHaveBeenCalledWith({
      continueTopicId: 'tpc_1',
      extraPrompt: DEPLOY_RESUME_TASK_PROMPT,
      taskId: 'task_1',
      trigger: 'deploy-resume',
    });
    expect(startComposerRun).not.toHaveBeenCalled();
  });

  it('writes the resume notice before the run starts', async () => {
    await resumeDeployRow(db, row({ kind: 'task', taskId: 'task_1' }));

    expect(createMessage).toHaveBeenCalledWith({
      agentId: 'agt_1',
      content: DEPLOY_RESUME_NOTICE,
      role: 'assistant',
      topicId: 'tpc_1',
    });
    expect(createMessage.mock.invocationCallOrder[0]).toBeLessThan(
      runTask.mock.invocationCallOrder[0],
    );
  });

  it('never writes the notice twice when a retry re-dispatches', async () => {
    await resumeDeployRow(db, row({ attempts: 2, kind: 'task', taskId: 'task_1' }));

    expect(createMessage).not.toHaveBeenCalled();
    expect(runTask).toHaveBeenCalled();
  });

  it('skips a row that lost its task id', async () => {
    await expect(resumeDeployRow(db, row({ kind: 'task', taskId: null }))).resolves.toEqual({
      reason: 'queue row has no task id',
      status: 'skipped',
    });

    expect(runTask).not.toHaveBeenCalled();
  });

  it('still replays while chat replay is off', async () => {
    vi.stubEnv('RESUME_CHAT_AFTER_DEPLOY', '');

    await resumeDeployRow(db, row({ kind: 'task', taskId: 'task_1' }));

    expect(runTask).toHaveBeenCalled();
  });
});

describe('chat rows', () => {
  it('stays off unless RESUME_CHAT_AFTER_DEPLOY turns it on', async () => {
    vi.stubEnv('RESUME_CHAT_AFTER_DEPLOY', '');

    await expect(resumeDeployRow(db, row())).resolves.toEqual({
      reason: 'chat replay is off (RESUME_CHAT_AFTER_DEPLOY)',
      status: 'skipped',
    });

    expect(findTopic).not.toHaveBeenCalled();
    expect(startComposerRun).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('re-sends the queued prompt through the composer path', async () => {
    await resumeDeployRow(db, row());

    expect(startComposerRun).toHaveBeenCalledWith(
      expect.objectContaining({ supersedeLiveRun: false, userId: 'user_1' }),
      expect.objectContaining({
        agentId: 'agt_1',
        appContext: { topicId: 'tpc_1' },
        existingMessageIds: [],
        prompt: '帮我继续这一步',
        queuedSuccessor: true,
        trigger: 'chat',
      }),
    );
    expect(runTask).not.toHaveBeenCalled();
  });

  it('falls back to the topic last user message when the payload has none', async () => {
    queryLastUserMessageByTopics.mockResolvedValue(new Map([['tpc_1', '  另一条消息  ']]));

    await resumeDeployRow(db, row({ payload: null }));

    expect(queryLastUserMessageByTopics).toHaveBeenCalledWith(['tpc_1']);
    expect(startComposerRun.mock.calls[0][1].prompt).toBe('另一条消息');
  });

  it('skips when there is no user message left to resend', async () => {
    await expect(
      resumeDeployRow(db, row({ payload: { settledAs: 'residual-chat' } })),
    ).resolves.toEqual({
      reason: 'no user message to resend',
      status: 'skipped',
    });

    expect(startComposerRun).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('skips a conversation with no single agent (group or unbound topic)', async () => {
    findTopic.mockResolvedValue(topic({ agentId: null, groupId: 'grp_1' }));

    await expect(resumeDeployRow(db, row())).resolves.toEqual({
      reason: 'topic has no single agent to resume',
      status: 'skipped',
    });

    expect(startComposerRun).not.toHaveBeenCalled();
  });
});

describe('skip conditions', () => {
  it('skips a topic that no longer exists', async () => {
    findTopic.mockResolvedValue(undefined);

    await expect(resumeDeployRow(db, row())).resolves.toEqual({
      reason: 'topic no longer exists',
      status: 'skipped',
    });
  });

  it('skips when the interrupted operation had actually finished', async () => {
    findOperation.mockResolvedValue({ id: 'op_1', status: 'done' });

    await expect(resumeDeployRow(db, row())).resolves.toEqual({
      reason: 'the interrupted run had already finished',
      status: 'skipped',
    });

    expect(startComposerRun).not.toHaveBeenCalled();
  });

  it('does not restart a topic that already has a live run', async () => {
    findLiveByTopic.mockResolvedValue([{ id: 'op_live' }]);

    await expect(resumeDeployRow(db, row())).resolves.toEqual({
      reason: 'topic already has a live run (op_live)',
      status: 'done',
    });

    expect(startComposerRun).not.toHaveBeenCalled();
    expect(runTask).not.toHaveBeenCalled();
  });
});

describe('failure handling', () => {
  it('retries a busy topic and then succeeds', async () => {
    vi.useFakeTimers();
    claim.mockResolvedValueOnce(row({ attempts: 1 })).mockResolvedValueOnce(row({ attempts: 2 }));
    startComposerRun
      .mockRejectedValueOnce(new TopicStartReservationError('topic busy'))
      .mockResolvedValueOnce({ operationId: 'op_2' });

    const promise = startDeployResume(db, 'drq_1');
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(release).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenLastCalledWith(db, 'drq_1', 'done', { error: null });
    expect(startComposerRun).toHaveBeenCalledTimes(2);
  });

  it('parks a row as failed once the attempt budget is spent', async () => {
    vi.useFakeTimers();
    claim.mockImplementation(async (_db: unknown, id: string) =>
      row({ attempts: (claim.mock.calls.length + 1) as number, id }),
    );
    startComposerRun.mockRejectedValue(new TopicStartReservationError('topic busy'));

    const promise = startDeployResume(db, 'drq_1');
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(claim).toHaveBeenCalledTimes(3);
    expect(finish).toHaveBeenLastCalledWith(db, 'drq_1', 'failed', { error: 'topic busy' });
  });

  it('skips immediately when the target is gone for good', async () => {
    startComposerRun.mockRejectedValue(
      new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' }),
    );

    await startDeployResume(db, 'drq_1');

    expect(claim).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(db, 'drq_1', 'skipped', { error: 'Agent not found' });
  });
});
