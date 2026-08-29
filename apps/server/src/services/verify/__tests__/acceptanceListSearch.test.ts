// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

describe('AcceptanceService.listWithSubjects', () => {
  it('searches the complete owned set before applying the result limit', async () => {
    const rows = [
      { createdAt: new Date(), id: 'recent', status: 'delivered', subjectId: 'recent' },
      { createdAt: new Date(0), id: 'older', status: 'delivered', subjectId: 'older' },
    ];
    const query = vi.fn().mockResolvedValue(rows);
    const service = new AcceptanceService({} as any, 'user-1') as any;
    service.acceptanceModel = { query };
    service.latestCheckCounts = vi.fn().mockResolvedValue(new Map());
    service.resolveProjects = vi.fn().mockResolvedValue(new Map());
    service.resolveSubject = vi.fn(async (row) => ({
      id: row.subjectId,
      title: row.id === 'older' ? 'Needle report' : 'Recent report',
      type: 'standalone',
    }));

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
    expect(result.map(({ id }) => id)).toEqual(['older']);
  });
});
