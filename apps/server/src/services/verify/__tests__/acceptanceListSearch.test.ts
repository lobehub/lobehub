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

  it("resolves a participated row's subject in its owner's scope", async () => {
    mocks.resolveTasks.mockReset();
    mocks.resolveTasks.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, identifier: id, name: `Task ${id}` })),
    );
    mocks.resolveTopics.mockResolvedValue([]);
    mocks.resolveDocuments.mockResolvedValue([]);
    mocks.taskScopes.length = 0;
    const rows = [
      { id: 'a', subjectId: 'mine', subjectType: 'task', userId: 'user-1', workspaceId: null },
      { id: 'b', subjectId: 'theirs', subjectType: 'task', userId: 'user-2', workspaceId: 'ws-2' },
    ];
    const service = new AcceptanceService({} as any, 'user-1') as any;
    service.acceptanceModel = { query: vi.fn().mockResolvedValue(rows) };
    service.latestCheckCounts = vi.fn().mockResolvedValue(new Map());
    service.resolveProjects = vi.fn().mockResolvedValue(new Map());
    // The owner-scoped service is a fresh instance — stub its check counts too.
    const originalReadByOwner = service.readByOwner;
    service.readByOwner = (items: unknown[], read: (svc: any, group: unknown[]) => unknown) =>
      originalReadByOwner(items, (svc: any, group: unknown[]) => {
        svc.latestCheckCounts = vi.fn().mockResolvedValue(new Map());
        return read(svc, group);
      });

    const result = await service.listWithSubjects({ scope: 'participated' });

    expect(mocks.taskScopes).toEqual(
      expect.arrayContaining([
        ['user-1', undefined],
        ['user-2', 'ws-2'],
      ]),
    );
    expect(result.map(({ subject }: { subject: { title: string } }) => subject.title)).toEqual([
      'Task mine',
      'Task theirs',
    ]);
  });
});
