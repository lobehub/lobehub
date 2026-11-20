// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

/**
 * Subject resolution: the header title a bundle shows, and the project an
 * aggregate is filed under when it is first created for a subject.
 */
const mocks = vi.hoisted(() => ({
  documentFindById: vi.fn(),
  ensureForSubject: vi.fn(),
  goalFindByNode: vi.fn(),
  projectFindById: vi.fn(),
  taskResolve: vi.fn(),
  taskTopicFindByTopicId: vi.fn(),
  topicFindOwnTopicById: vi.fn(),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(function () {
    return { ensureForSubject: mocks.ensureForSubject };
  }),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return { resolve: mocks.taskResolve };
  }),
}));
vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(function () {
    return { findByTopicId: mocks.taskTopicFindByTopicId };
  }),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findOwnTopicById: mocks.topicFindOwnTopicById };
  }),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findById: mocks.documentFindById };
  }),
}));
vi.mock('@/database/models/goal', () => ({
  GoalModel: vi.fn(function () {
    return { findByNode: mocks.goalFindByNode };
  }),
}));
vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn(function () {
    return { findById: mocks.projectFindById };
  }),
}));
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

const service = () => new AcceptanceService({} as any, 'user-1', 'ws-1');

const acceptance = (subjectType: string, metadata: Record<string, unknown> = {}) =>
  ({ id: 'acc-1', metadata, subjectId: 'subject-1', subjectType }) as any;

describe('AcceptanceService subjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureForSubject.mockResolvedValue({ id: 'acc-1' });
  });

  describe('resolveSubject', () => {
    it.each([
      {
        expected: 'T-1',
        setup: () => mocks.taskResolve.mockResolvedValue({ identifier: 'T-1', name: null }),
        type: 'task',
      },
      {
        expected: 'Topic title',
        setup: () => mocks.topicFindOwnTopicById.mockResolvedValue({ title: 'Topic title' }),
        type: 'topic',
      },
      {
        expected: 'Doc title',
        setup: () => mocks.documentFindById.mockResolvedValue({ title: 'Doc title' }),
        type: 'document',
      },
      {
        expected: 'Goal title',
        setup: () => mocks.goalFindByNode.mockResolvedValue({ title: 'Goal title' }),
        type: 'goal_gate',
      },
      { expected: null, setup: () => {}, type: 'standalone' },
      {
        expected: null,
        setup: () => mocks.taskResolve.mockRejectedValue(new Error('db down')),
        type: 'task',
      },
    ])('resolves a $type subject title to $expected', async ({ expected, setup, type }) => {
      setup();

      await expect(service().resolveSubject(acceptance(type))).resolves.toEqual({
        id: 'subject-1',
        title: expected,
        type,
      });
    });

    it('prefers a trimmed user rename over the subject lookup', async () => {
      await expect(
        service().resolveSubject(acceptance('task', { title: '  Renamed  ' })),
      ).resolves.toEqual({ id: 'subject-1', title: 'Renamed', type: 'task' });
      expect(mocks.taskResolve).not.toHaveBeenCalled();
    });
  });

  describe('ensureForSubject', () => {
    it("files a goal-gate subject under its goal's project", async () => {
      mocks.goalFindByNode.mockResolvedValue({ projectId: 'project-goal', title: 'Goal' });

      await service().ensureForSubject('goal_gate', 'node-1');

      expect(mocks.goalFindByNode).toHaveBeenCalledWith('node-1');
      expect(mocks.ensureForSubject).toHaveBeenCalledWith('goal_gate', 'node-1', {
        config: undefined,
        projectId: 'project-goal',
        requirement: undefined,
      });
    });

    it("files a task run topic under its task's project", async () => {
      mocks.topicFindOwnTopicById.mockResolvedValue({ title: 'Run topic' });
      mocks.taskTopicFindByTopicId.mockResolvedValue({ taskId: 'task-1' });
      mocks.taskResolve.mockResolvedValue({ projectId: 'project-task' });

      await service().ensureForSubject('topic', 'topic-1', { requirement: 'req' });

      expect(mocks.taskResolve).toHaveBeenCalledWith('task-1');
      expect(mocks.ensureForSubject).toHaveBeenCalledWith('topic', 'topic-1', {
        config: undefined,
        projectId: 'project-task',
        requirement: 'req',
      });
    });

    it("files a project conversation topic under the topic's own project", async () => {
      mocks.topicFindOwnTopicById.mockResolvedValue({
        projectId: 'project-topic',
        title: 'Project chat',
      });

      await service().ensureForSubject('topic', 'topic-1');

      expect(mocks.taskTopicFindByTopicId).not.toHaveBeenCalled();
      expect(mocks.ensureForSubject).toHaveBeenCalledWith('topic', 'topic-1', {
        config: undefined,
        projectId: 'project-topic',
        requirement: undefined,
      });
    });

    it('files under a project the caller names instead of the one the subject implies', async () => {
      mocks.topicFindOwnTopicById.mockResolvedValue({
        projectId: 'project-topic',
        title: 'Project chat',
      });
      mocks.projectFindById.mockResolvedValue({ id: 'project-named' });

      await service().ensureForSubject('topic', 'topic-1', { projectId: 'project-named' });

      expect(mocks.projectFindById).toHaveBeenCalledWith('project-named');
      expect(mocks.ensureForSubject).toHaveBeenCalledWith('topic', 'topic-1', {
        config: undefined,
        projectId: 'project-named',
        requirement: undefined,
      });
    });

    it("keeps the subject's own project over the repository's fallback", async () => {
      mocks.topicFindOwnTopicById.mockResolvedValue({
        projectId: 'project-topic',
        title: 'Project chat',
      });

      await service().ensureForSubject('topic', 'topic-1', { fallbackProjectId: 'project-repo' });

      expect(mocks.projectFindById).not.toHaveBeenCalled();
      expect(mocks.ensureForSubject).toHaveBeenCalledWith(
        'topic',
        'topic-1',
        expect.objectContaining({ projectId: 'project-topic' }),
      );
    });

    it("files under the repository's fallback when the subject implies no project", async () => {
      mocks.projectFindById.mockResolvedValue({ id: 'project-repo' });

      await service().ensureForSubject('standalone', 'standalone-1', {
        fallbackProjectId: 'project-repo',
      });

      expect(mocks.ensureForSubject).toHaveBeenCalledWith(
        'standalone',
        'standalone-1',
        expect.objectContaining({ projectId: 'project-repo' }),
      );
    });

    it('rejects a named project the caller cannot read, before creating anything', async () => {
      mocks.projectFindById.mockResolvedValue(null);

      await expect(
        service().ensureForSubject('standalone', 'standalone-1', { projectId: 'project-x' }),
      ).rejects.toThrow('project "project-x" not found in the current workspace');
      expect(mocks.ensureForSubject).not.toHaveBeenCalled();
    });

    it('stores a standalone title as metadata without a project', async () => {
      await service().ensureForSubject('standalone', 'standalone-1', { title: 'Report' });

      expect(mocks.ensureForSubject).toHaveBeenCalledWith('standalone', 'standalone-1', {
        config: undefined,
        metadata: { title: 'Report' },
        projectId: null,
        requirement: undefined,
      });
    });

    it('keys a task addressed by its identifier under the task id', async () => {
      mocks.taskResolve.mockResolvedValue({
        id: 'task_abc',
        identifier: 'T-898',
        name: 'Fix docs',
        projectId: 'project-task',
      });

      await service().ensureForSubject('task', 'T-898', { requirement: 'req' });

      expect(mocks.ensureForSubject).toHaveBeenCalledWith('task', 'task_abc', {
        config: undefined,
        projectId: 'project-task',
        requirement: 'req',
      });
    });

    it('rejects a subject missing from the current workspace', async () => {
      mocks.taskResolve.mockResolvedValue(undefined);

      await expect(service().ensureForSubject('task', 'task-x')).rejects.toThrow(
        'task "task-x" not found in the current workspace',
      );
      expect(mocks.ensureForSubject).not.toHaveBeenCalled();
    });
  });

  describe('resolveCanonicalSubjectId', () => {
    it('maps a task identifier to the task id', async () => {
      mocks.taskResolve.mockResolvedValue({ id: 'task_abc', identifier: 'T-898' });

      await expect(service().resolveCanonicalSubjectId('task', 'T-898')).resolves.toBe('task_abc');
    });

    it('passes an unknown task and non-task subjects through', async () => {
      mocks.taskResolve.mockResolvedValue(null);

      await expect(service().resolveCanonicalSubjectId('task', 'T-404')).resolves.toBe('T-404');
      await expect(service().resolveCanonicalSubjectId('topic', 'tpc_1')).resolves.toBe('tpc_1');
      expect(mocks.taskResolve).toHaveBeenCalledTimes(1);
    });
  });
});
