// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

/**
 * The paged list read: the filter becomes a status set in the query, and each
 * row is decorated with its subject header, project and latest check count.
 */
const mocks = vi.hoisted(() => ({
  projectFindByIds: vi.fn(),
  queryPage: vi.fn(),
  taskResolveRefs: vi.fn(),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(function () {
    return { queryPage: mocks.queryPage };
  }),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return { resolveRefs: mocks.taskResolveRefs };
  }),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { findOwnTopicsByIds: vi.fn().mockResolvedValue([]) };
  }),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findByIds: vi.fn().mockResolvedValue([]) };
  }),
}));
vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn(function () {
    return { findByIds: mocks.projectFindByIds };
  }),
}));
vi.mock('@/server/services/task', () => ({ TaskService: vi.fn() }));

const rows = [
  {
    id: 'acc-1',
    metadata: {},
    projectId: 'project-1',
    subjectId: 'task-1',
    subjectType: 'task',
    userId: 'user-1',
    workspaceId: null,
  },
  {
    id: 'acc-2',
    metadata: { title: 'Kept title' },
    projectId: null,
    subjectId: 'task-2',
    subjectType: 'task',
    userId: 'user-1',
    workspaceId: null,
  },
];

const db = () => ({
  query: {
    verifyReports: {
      findMany: vi.fn().mockResolvedValue([{ totalChecks: 4, verifyRunId: 'run-1b' }]),
    },
    verifyRuns: {
      findMany: vi.fn().mockResolvedValue([
        { acceptanceId: 'acc-1', id: 'run-1a', roundIndex: 1 },
        { acceptanceId: 'acc-1', id: 'run-1b', roundIndex: 2 },
      ]),
    },
  },
});

describe('AcceptanceService.listPageWithSubjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryPage.mockResolvedValue({ items: rows, nextCursor: 'cursor-2' });
    mocks.taskResolveRefs.mockResolvedValue({
      byRef: new Map([['task-1', { id: 'task-1', identifier: 'T-1', name: 'Task 1' }]]),
    });
    mocks.projectFindByIds.mockResolvedValue([{ id: 'project-1', name: 'Project 1' }]);
  });

  it('queries the filter as a status set and decorates each row', async () => {
    const service = new AcceptanceService(db() as any, 'user-1');

    const page = await service.listPageWithSubjects({
      cursor: 'cursor-1',
      filter: 'completed',
      limit: 30,
    });

    expect(mocks.queryPage).toHaveBeenCalledWith({
      cursor: 'cursor-1',
      limit: 30,
      projectId: undefined,
      scope: undefined,
      source: undefined,
      statuses: ['accepted', 'closed'],
    });
    expect(mocks.projectFindByIds).toHaveBeenCalledWith(['project-1']);
    expect(page.nextCursor).toBe('cursor-2');
    expect(
      page.items.map(({ checkCount, id, project, subject }) => ({
        checkCount,
        id,
        project,
        subject,
      })),
    ).toEqual([
      {
        checkCount: 4,
        id: 'acc-1',
        project: { id: 'project-1', name: 'Project 1' },
        subject: { id: 'task-1', title: 'Task 1', type: 'task' },
      },
      {
        checkCount: null,
        id: 'acc-2',
        project: null,
        subject: { id: 'task-2', title: 'Kept title', type: 'task' },
      },
    ]);
  });

  it('degrades subject titles and projects when their reads fail', async () => {
    mocks.taskResolveRefs.mockRejectedValue(new Error('db down'));
    mocks.projectFindByIds.mockRejectedValue(new Error('db down'));
    const service = new AcceptanceService(db() as any, 'user-1');

    const page = await service.listPageWithSubjects({});

    expect(mocks.queryPage).toHaveBeenCalledWith(expect.objectContaining({ statuses: undefined }));
    expect(page.items.map(({ project, subject }) => ({ project, title: subject.title }))).toEqual([
      { project: null, title: null },
      { project: null, title: 'Kept title' },
    ]);
  });
});
