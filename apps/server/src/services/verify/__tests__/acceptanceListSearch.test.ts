// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

const mocks = vi.hoisted(() => ({
  resolveDocuments: vi.fn(),
  resolveTasks: vi.fn(),
  resolveTopics: vi.fn(),
  taskScopes: [] as Array<[string, string | undefined]>,
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: class {
    findByIds = mocks.resolveDocuments;
  },
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: class {
    constructor(_db: unknown, userId: string, workspaceId?: string) {
      mocks.taskScopes.push([userId, workspaceId]);
    }
    resolveMany = mocks.resolveTasks;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findOwnTopicsByIds = mocks.resolveTopics;
  },
}));

describe('AcceptanceService.listWithSubjects', () => {
  it('searches the complete owned set before applying the result limit', async () => {
    const rows = [
      {
        createdAt: new Date(),
        id: 'recent',
        status: 'delivered',
        subjectId: 'recent',
        subjectType: 'task',
        userId: 'user-1',
      },
      {
        createdAt: new Date(0),
        id: 'older',
        status: 'delivered',
        subjectId: 'older',
        subjectType: 'topic',
        userId: 'user-1',
      },
    ];
    const query = vi.fn().mockResolvedValue(rows);
    mocks.resolveTasks.mockResolvedValue([
      { id: 'recent', identifier: 'T-1', name: 'Recent report' },
    ]);
    mocks.resolveTopics.mockResolvedValue([{ id: 'older', title: 'Needle report' }]);
    mocks.resolveDocuments.mockResolvedValue([]);
    const service = new AcceptanceService({} as any, 'user-1') as any;
    service.acceptanceModel = { query };
    service.latestCheckCounts = vi.fn().mockResolvedValue(new Map());
    service.resolveProjects = vi.fn().mockResolvedValue(new Map());

    const result = await service.listWithSubjects({ filter: 'active', limit: 1, q: 'needle' });

    expect(query).toHaveBeenCalledWith({
      limit: undefined,
      statuses: [
        'pending',
        'planned',
        'verifying',
        'repairing',
        'delivered',
        'rejected',
        'errored',
      ],
      unbounded: true,
    });
    expect(mocks.resolveTasks).toHaveBeenCalledOnce();
    expect(mocks.resolveTasks).toHaveBeenCalledWith(['recent']);
    expect(mocks.resolveTopics).toHaveBeenCalledOnce();
    expect(mocks.resolveTopics).toHaveBeenCalledWith(['older']);
    expect(mocks.resolveDocuments).toHaveBeenCalledOnce();
    expect(result.map(({ id }: { id: string }) => id)).toEqual(['older']);
  });

  it('scopes the candidate query to a project', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const service = new AcceptanceService({} as any, 'user-1') as any;
    service.acceptanceModel = { query };
    service.latestCheckCounts = vi.fn().mockResolvedValue(new Map());
    service.resolveProjects = vi.fn().mockResolvedValue(new Map());

    await service.listWithSubjects({ filter: 'all', projectId: 'project-1' });

    expect(query).toHaveBeenCalledWith({
      limit: 50,
      projectId: 'project-1',
      statuses: undefined,
      unbounded: false,
    });
  });

  it('passes the scope and source narrowings to the candidate query', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const service = new AcceptanceService({} as any, 'user-1') as any;
    service.acceptanceModel = { query };

    await service.listWithSubjects({ projectId: null, scope: 'participated', source: 'goal' });

    expect(query).toHaveBeenCalledWith({
      limit: 50,
      projectId: null,
      scope: 'participated',
      source: 'goal',
      statuses: undefined,
      unbounded: false,
    });
  });

  it('resolves foreign rows in a fixed number of reads however many owners a page spans', async () => {
    mocks.resolveTasks.mockReset();
    mocks.resolveTasks.mockResolvedValue([{ id: 'mine', identifier: 'T-1', name: 'Task mine' }]);
    mocks.resolveTopics.mockResolvedValue([]);
    mocks.resolveDocuments.mockResolvedValue([]);
    mocks.taskScopes.length = 0;

    const foreignOwners = ['user-2', 'user-3', 'user-4', 'user-5'];
    const rows = [
      { id: 'a', subjectId: 'mine', subjectType: 'task', userId: 'user-1', workspaceId: null },
      ...foreignOwners.map((owner, index) => ({
        id: `f${index}`,
        subjectId: `theirs-${index}`,
        subjectType: index % 2 ? 'topic' : 'task',
        userId: owner,
        workspaceId: index === 0 ? 'ws-2' : null,
      })),
    ];
    const db = {
      query: {
        documents: { findMany: vi.fn().mockResolvedValue([]) },
        tasks: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'theirs-0', identifier: 'X-1', name: 'Task theirs-0' },
            { id: 'theirs-2', identifier: 'X-3', name: null },
          ]),
        },
        topics: {
          findMany: vi.fn().mockResolvedValue([{ id: 'theirs-1', title: 'Topic theirs-1' }]),
        },
      },
    };
    const service = new AcceptanceService(db as any, 'user-1') as any;
    service.acceptanceModel = { query: vi.fn().mockResolvedValue(rows) };
    service.latestCheckCounts = vi.fn().mockResolvedValue(new Map());
    service.resolveProjects = vi.fn().mockResolvedValue(new Map());

    const result = await service.listWithSubjects({ scope: 'participated' });

    // One scoped read for the caller's own rows, one unscoped read per type
    // for everyone else's — never a read per owner.
    expect(mocks.taskScopes).toEqual([['user-1', undefined]]);
    expect(db.query.tasks.findMany).toHaveBeenCalledOnce();
    expect(db.query.topics.findMany).toHaveBeenCalledOnce();
    expect(db.query.documents.findMany).not.toHaveBeenCalled();
    expect(service.latestCheckCounts).toHaveBeenCalledOnce();
    expect(
      result.map(({ subject }: { subject: { title: string | null } }) => subject.title),
    ).toEqual(['Task mine', 'Task theirs-0', 'Topic theirs-1', 'X-3', null]);
  });

  it('reads check counts for rows of any owner in two batched queries', async () => {
    const db = {
      query: {
        verifyReports: {
          findMany: vi.fn().mockResolvedValue([
            { totalChecks: 5, verifyRunId: 'run-a2' },
            { totalChecks: 3, verifyRunId: 'run-b1' },
          ]),
        },
        verifyRuns: {
          findMany: vi.fn().mockResolvedValue([
            { acceptanceId: 'a', id: 'run-a1', roundIndex: 1 },
            { acceptanceId: 'a', id: 'run-a2', roundIndex: 2 },
            { acceptanceId: 'b', id: 'run-b1', roundIndex: 1 },
          ]),
        },
      },
    };
    const service = new AcceptanceService(db as any, 'user-1') as any;

    const counts = await service.latestCheckCounts(['a', 'b']);

    expect(db.query.verifyRuns.findMany).toHaveBeenCalledOnce();
    expect(db.query.verifyReports.findMany).toHaveBeenCalledOnce();
    expect([...counts]).toEqual([
      ['a', 5],
      ['b', 3],
    ]);
  });
});
