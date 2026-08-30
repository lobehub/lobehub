// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

const mocks = vi.hoisted(() => ({
  resolveDocuments: vi.fn(),
  resolveTasks: vi.fn(),
  resolveTopics: vi.fn(),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: class {
    findByIds = mocks.resolveDocuments;
  },
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: class {
    resolveMany = mocks.resolveTasks;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findByIds = mocks.resolveTopics;
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
      },
      {
        createdAt: new Date(0),
        id: 'older',
        status: 'delivered',
        subjectId: 'older',
        subjectType: 'topic',
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
});
